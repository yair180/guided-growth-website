#!/usr/bin/env python3
"""
Sync task metadata from the Google Master Sheet (Tasks tab) into
architecture/index.html in this repo. Read-only with respect to the Sheet.

Usage:
    python3 scripts/sync_sheet_to_html.py --dry-run     # preview
    python3 scripts/sync_sheet_to_html.py               # apply

Only `status`, `stage`, and `owner` of EXISTING tasks in the HTML are
updated. New tasks are NOT added; deleted tasks are NOT removed; other
fields (name, steps, etc.) are NOT touched.

Path resolution:
    - HTML: repo_root/architecture/index.html  (override: $GG_HTML_PATH)
    - Creds: $GG_CREDS_PATH OR $GG_CREDS_JSON (raw JSON string)
             OR ~/.config/guided-growth/service-account.json
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import warnings
from pathlib import Path
from typing import Any

warnings.filterwarnings("ignore", category=FutureWarning)

from sheet_html_mapping import (
    HANDLE_TO_NAME,
    parse_owners,
    parse_stage,
    parse_status,
)

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT  = SCRIPT_DIR.parent

HTML_PATH = Path(
    os.environ.get("GG_HTML_PATH")
    or REPO_ROOT / "architecture" / "index.html"
)

SHEET_ID    = "1iNEdUm5vqmjk3YGEF1uMwfurcvgVRHykWUeBGHDBqcw"
TASKS_RANGE = "Tasks!A:Z"           # tolerant of column reorder + extra cols
SCOPES      = ["https://www.googleapis.com/auth/spreadsheets.readonly"]

REQUIRED_COLUMNS = (
    "Task ID", "Title", "Assignee", "Status",
)


# ─── Credentials ──────────────────────────────────────────────────────────

def load_credentials():
    from google.oauth2 import service_account

    creds_json = os.environ.get("GG_CREDS_JSON")
    if creds_json:
        info = json.loads(creds_json)
        return service_account.Credentials.from_service_account_info(
            info, scopes=SCOPES
        )

    creds_path = Path(
        os.environ.get("GG_CREDS_PATH")
        or Path.home() / ".config/guided-growth/service-account.json"
    )
    if not creds_path.exists():
        sys.exit(f"ERROR: service account credentials not found at {creds_path}")
    return service_account.Credentials.from_service_account_file(
        str(creds_path), scopes=SCOPES
    )


# ─── Sheet I/O ────────────────────────────────────────────────────────────

def _with_retry(callable_, *, attempts: int = 5, base_delay: float = 1.0):
    """Run a Sheets API .execute() callable with exponential backoff on
    transient errors (5xx, 429, network blips). Re-raise the last error
    only if every attempt fails. Designed so cron-driven runs don't email
    failures on Google-side hiccups."""
    import time
    from googleapiclient.errors import HttpError

    last_exc = None
    for i in range(attempts):
        try:
            return callable_()
        except HttpError as e:
            last_exc = e
            status = getattr(e.resp, "status", None)
            transient = status in (429, 500, 502, 503, 504)
            if not transient or i == attempts - 1:
                raise
            sleep_s = base_delay * (2 ** i)
            print(f"  retry {i+1}/{attempts-1} after HTTP {status} — sleeping {sleep_s}s",
                  file=sys.stderr, flush=True)
            time.sleep(sleep_s)
        except Exception as e:
            last_exc = e
            if i == attempts - 1:
                raise
            sleep_s = base_delay * (2 ** i)
            print(f"  retry {i+1}/{attempts-1} after {type(e).__name__}: {e} — sleeping {sleep_s}s",
                  file=sys.stderr, flush=True)
            time.sleep(sleep_s)
    if last_exc:
        raise last_exc


def fetch_sheet_rows() -> list[list[str]]:
    from googleapiclient.discovery import build

    creds = load_credentials()
    svc = build("sheets", "v4", credentials=creds)
    req = svc.spreadsheets().values().get(spreadsheetId=SHEET_ID, range=TASKS_RANGE)
    result = _with_retry(req.execute)
    return result.get("values", [])


def build_sheet_index(rows: list[list[str]]) -> dict[str, dict[str, str]]:
    """Map Task ID → row dict (header name → cell value).

    Looks up columns by header name so the script keeps working even
    if the team reorders columns in the Sheet.
    """
    if not rows:
        return {}
    headers = [(h or "").strip() for h in rows[0]]
    col = {h: i for i, h in enumerate(headers) if h}

    missing = [c for c in REQUIRED_COLUMNS if c not in col]
    if missing:
        sys.exit(
            "ERROR: required column(s) missing from the Tasks tab header: "
            + ", ".join(missing)
            + f"\n  Got: {headers}"
        )

    by_id: dict[str, dict[str, str]] = {}
    for row in rows[1:]:
        if not row:
            continue
        padded = list(row) + [""] * (len(headers) - len(row))
        task_id = (padded[col["Task ID"]] or "").strip()
        if not task_id:
            continue
        by_id[task_id] = {name: padded[i] for name, i in col.items()}
    return by_id


# ─── HTML I/O ─────────────────────────────────────────────────────────────

_TASK_TUTORIALS_OPEN = re.compile(
    r"const\s+TASK_TUTORIALS\s*=\s*\[", re.MULTILINE
)


def find_task_tutorials_block(html: str) -> tuple[int, int]:
    """Return (start_idx, end_idx_exclusive) of the `[...]` literal contents."""
    m = _TASK_TUTORIALS_OPEN.search(html)
    if not m:
        sys.exit("ERROR: could not find `const TASK_TUTORIALS = [` in HTML")
    open_bracket = m.end() - 1
    depth = 0
    i = open_bracket
    in_string: str | None = None
    while i < len(html):
        ch = html[i]
        if in_string:
            if ch == "\\":
                i += 2
                continue
            if ch == in_string:
                in_string = None
            i += 1
            continue
        if ch in ('"', "'", "`"):
            in_string = ch
            i += 1
            continue
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                return open_bracket, i + 1
        i += 1
    sys.exit("ERROR: unterminated TASK_TUTORIALS array literal")


def iter_task_objects(literal_body: str) -> list[tuple[int, int]]:
    spans: list[tuple[int, int]] = []
    i = 0
    n = len(literal_body)
    in_string: str | None = None
    in_line_comment = False
    in_block_comment = False
    while i < n:
        ch = literal_body[i]
        if in_line_comment:
            if ch == "\n":
                in_line_comment = False
            i += 1
            continue
        if in_block_comment:
            if ch == "*" and i + 1 < n and literal_body[i + 1] == "/":
                in_block_comment = False
                i += 2
                continue
            i += 1
            continue
        if in_string:
            if ch == "\\":
                i += 2
                continue
            if ch == in_string:
                in_string = None
            i += 1
            continue
        if ch == "/" and i + 1 < n:
            nxt = literal_body[i + 1]
            if nxt == "/":
                in_line_comment = True
                i += 2
                continue
            if nxt == "*":
                in_block_comment = True
                i += 2
                continue
        if ch in ('"', "'", "`"):
            in_string = ch
            i += 1
            continue
        if ch == "{":
            start = i
            depth = 0
            j = i
            sub_string: str | None = None
            sub_line = False
            sub_block = False
            while j < n:
                cj = literal_body[j]
                if sub_line:
                    if cj == "\n":
                        sub_line = False
                    j += 1
                    continue
                if sub_block:
                    if cj == "*" and j + 1 < n and literal_body[j + 1] == "/":
                        sub_block = False
                        j += 2
                        continue
                    j += 1
                    continue
                if sub_string:
                    if cj == "\\":
                        j += 2
                        continue
                    if cj == sub_string:
                        sub_string = None
                    j += 1
                    continue
                if cj == "/" and j + 1 < n:
                    if literal_body[j + 1] == "/":
                        sub_line = True
                        j += 2
                        continue
                    if literal_body[j + 1] == "*":
                        sub_block = True
                        j += 2
                        continue
                if cj in ('"', "'", "`"):
                    sub_string = cj
                    j += 1
                    continue
                if cj == "{":
                    depth += 1
                elif cj == "}":
                    depth -= 1
                    if depth == 0:
                        spans.append((start, j + 1))
                        i = j + 1
                        break
                j += 1
            else:
                sys.exit("ERROR: unterminated task object literal")
            continue
        i += 1
    return spans


_TASKID_RE = re.compile(r'taskId\s*:\s*"([^"]+)"')
_STATUS_RE = re.compile(r'(status\s*:\s*)"([^"]+)"')
_STAGE_RE  = re.compile(r'(stage\s*:\s*)(\d+)')
_OWNER_RE  = re.compile(r'(owner\s*:\s*)\[([^\]]*)\]')


def parse_owner_literal(raw: str) -> list[str]:
    return [m.group(1) for m in re.finditer(r'"([^"]*)"', raw)]


def render_owner_literal(names: list[str]) -> str:
    return ", ".join(f'"{n}"' for n in names)


# ─── Main sync ────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true",
                    help="Show changes without writing the HTML")
    args = ap.parse_args()

    if not HTML_PATH.exists():
        print(f"ERROR: HTML not found at {HTML_PATH}", file=sys.stderr)
        return 1

    print(f"HTML: {HTML_PATH}")
    print(f"Reading sheet…")
    sheet_rows = fetch_sheet_rows()
    by_id = build_sheet_index(sheet_rows)
    print(f"  {len(by_id)} tasks in sheet")

    html = HTML_PATH.read_text(encoding="utf-8")
    body_start, body_end = find_task_tutorials_block(html)
    literal = html[body_start:body_end]
    inner = literal[1:-1]
    task_spans = iter_task_objects(inner)
    print(f"  {len(task_spans)} tasks in HTML")

    changes: list[str] = []
    skipped_missing_in_sheet: list[str] = []
    skipped_unknown_handles: dict[str, list[str]] = {}
    new_inner_parts: list[str] = []
    cursor = 0

    for start, end in task_spans:
        new_inner_parts.append(inner[cursor:start])
        original = inner[start:end]

        m_id = _TASKID_RE.search(original)
        if not m_id:
            new_inner_parts.append(original)
            cursor = end
            continue
        task_id = m_id.group(1)
        sheet_row = by_id.get(task_id)
        if sheet_row is None:
            skipped_missing_in_sheet.append(task_id)
            new_inner_parts.append(original)
            cursor = end
            continue

        updated = original

        # Stage column was dropped 2026-05-08 (consolidation per call with
        # Mint + Yonas). parse_status's stage arg now always empty; Done /
        # Obsolete must be set directly in Status.
        new_status = parse_status(sheet_row.get("Status", ""), "")
        m_status = _STATUS_RE.search(updated)
        if m_status:
            old_status = m_status.group(2)
            if old_status != new_status:
                updated = (
                    updated[:m_status.start(2) - 1]
                    + f'"{new_status}"'
                    + updated[m_status.end(2) + 1:]
                )
                changes.append(f"  {task_id}: status {old_status} → {new_status}")

        # Stage column dropped 2026-05-08; HTML's `stage:` field stays at its
        # current value (sync no longer updates it). parse_stage("") returns
        # None which is the no-op signal.
        new_stage = parse_stage(sheet_row.get("Stage", ""))
        if new_stage is not None:
            m_stage = _STAGE_RE.search(updated)
            if m_stage:
                old_stage = int(m_stage.group(2))
                if old_stage != new_stage:
                    updated = (
                        updated[:m_stage.start(2)]
                        + str(new_stage)
                        + updated[m_stage.end(2):]
                    )
                    changes.append(f"  {task_id}: stage {old_stage} → {new_stage}")

        unknown_for_task: list[str] = []
        new_owners = parse_owners(
            sheet_row["Assignee"],
            on_unknown=unknown_for_task.append,
        )
        if unknown_for_task:
            skipped_unknown_handles[task_id] = unknown_for_task
        if new_owners:
            m_owner = _OWNER_RE.search(updated)
            if m_owner:
                old_raw = m_owner.group(2)
                old_owners = parse_owner_literal(old_raw)
                if old_owners != new_owners:
                    new_raw = render_owner_literal(new_owners)
                    updated = (
                        updated[:m_owner.start(2)]
                        + new_raw
                        + updated[m_owner.end(2):]
                    )
                    changes.append(
                        f"  {task_id}: owner {old_owners} → {new_owners}"
                    )

        new_inner_parts.append(updated)
        cursor = end

    new_inner_parts.append(inner[cursor:])
    new_inner = "".join(new_inner_parts)
    new_html = html[:body_start] + "[" + new_inner + "]" + html[body_end:]

    sheet_only = sorted(set(by_id) - {
        _TASKID_RE.search(inner[s:e]).group(1)
        for s, e in task_spans
        if _TASKID_RE.search(inner[s:e])
    })

    print()
    mode = "DRY RUN — no files written" if args.dry_run else "APPLIED"
    print(f"=== {mode} ===")
    print(f"Synced {len(task_spans)} tasks from Sheet → HTML")
    if changes:
        print(f"\nChanges ({len(changes)}):")
        print("\n".join(changes))
    else:
        print("\nNo changes — HTML already matches Sheet.")
    if skipped_missing_in_sheet:
        print(
            f"\nSkipped {len(skipped_missing_in_sheet)} task(s) in HTML "
            f"but not in Sheet: {', '.join(skipped_missing_in_sheet)}"
        )
    if sheet_only:
        print(
            f"\nIn Sheet but not in HTML ({len(sheet_only)}, not added): "
            f"{', '.join(sheet_only)}"
        )
    if skipped_unknown_handles:
        print(f"\nUnknown assignee handles (logged, owner field skipped):")
        for tid, handles in skipped_unknown_handles.items():
            print(f"  {tid}: {handles}")

    if args.dry_run:
        print("\nRe-run without --dry-run to write changes.")
        return 0

    if changes:
        HTML_PATH.write_text(new_html, encoding="utf-8")
        print(f"\nWrote {HTML_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
