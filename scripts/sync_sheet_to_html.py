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

SHEET_ID      = "1iNEdUm5vqmjk3YGEF1uMwfurcvgVRHykWUeBGHDBqcw"
TASKS_RANGE   = "Tasks!A:Z"           # tolerant of column reorder + extra cols
SCREENS_RANGE = "Screens!A:Z"         # zoom-5 view sources from this
SCOPES        = ["https://www.googleapis.com/auth/spreadsheets.readonly"]

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


def build_task_index(rows: list[list[str]]) -> list[dict]:
    """List of {i: taskId, r: 1-indexed sheet row, t: title, s: status}
    in sheet-row order. Powers zoom-4's task sidebar.
    """
    if not rows:
        return []
    headers = [(h or "").strip() for h in rows[0]]
    try:
        tcol = headers.index("Task ID")
    except ValueError:
        return []
    title_col = headers.index("Title") if "Title" in headers else -1
    status_col = headers.index("Status") if "Status" in headers else -1

    out: list[dict] = []
    for i, row in enumerate(rows[1:], start=2):
        if not row:
            continue
        padded = list(row) + [""] * (len(headers) - len(row))
        tid = (padded[tcol] or "").strip()
        if not tid:
            continue
        out.append({
            "i": tid,
            "r": i,
            "t": (padded[title_col] or "").strip() if title_col >= 0 else "",
            "s": (padded[status_col] or "").strip() if status_col >= 0 else "",
        })
    return out


_TASK_INDEX_RE = re.compile(
    r"const\s+TASK_INDEX\s*=\s*\[.*?\]\s*;",
    re.MULTILINE | re.DOTALL,
)


def upsert_task_index(html: str, entries: list[dict]) -> tuple[str, bool]:
    """Replace the inline TASK_INDEX JS array with the fresh snapshot.

    Compact JSON keeps diffs small. Returns (new_html, changed).
    """
    if not entries:
        return html, False
    payload = json.dumps(entries, separators=(",", ":"), ensure_ascii=False)
    replacement = f"const TASK_INDEX = {payload};"
    new_html, n = _TASK_INDEX_RE.subn(replacement, html, count=1)
    if n == 0:
        return html, False
    return new_html, new_html != html


def fetch_screens_rows() -> list[list[str]]:
    """Fetch the Screens tab. Returns [] on any failure (this is non-fatal —
    if the Screens tab vanishes we'd rather skip the SCREEN_INDEX update than
    abort the whole sync).
    """
    try:
        from googleapiclient.discovery import build
        creds = load_credentials()
        svc = build("sheets", "v4", credentials=creds)
        req = svc.spreadsheets().values().get(spreadsheetId=SHEET_ID, range=SCREENS_RANGE)
        return _with_retry(req.execute).get("values", [])
    except Exception as exc:
        print(f"WARN: could not fetch Screens tab — skipping SCREEN_INDEX sync: {exc}")
        return []


_NODE_FROM_URL_RE = re.compile(r"node-id=([0-9-]+)")


def build_screen_index(rows: list[list[str]]) -> list[dict]:
    """List of {i: screen_id, n: name, p: phase, f: figma_node_id} powering
    zoom-5's screen sidebar. Skips header, empty, and placeholder rows.
    """
    if not rows:
        return []
    headers = [(h or "").strip() for h in rows[0]]
    try:
        sid_col = headers.index("Screen ID")
    except ValueError:
        return []
    name_col  = headers.index("Screen Name") if "Screen Name" in headers else -1
    phase_col = headers.index("Phase")       if "Phase"       in headers else -1
    fl_col    = headers.index("Figma Link")  if "Figma Link"  in headers else -1

    out: list[dict] = []
    for row in rows[1:]:
        if not row:
            continue
        padded = list(row) + [""] * (len(headers) - len(row))
        sid = (padded[sid_col] or "").strip()
        if not sid or sid.startswith("(") or "[DEPRECATED]" in sid:
            continue
        url = (padded[fl_col] or "").strip() if fl_col >= 0 else ""
        m = _NODE_FROM_URL_RE.search(url)
        node_id = m.group(1).replace("-", ":") if m else ""
        out.append({
            "i": sid,
            "n": (padded[name_col] or "").strip() if name_col  >= 0 else "",
            "p": (padded[phase_col] or "").strip() if phase_col >= 0 else "",
            "f": node_id,
        })
    return out


_SCREEN_INDEX_RE = re.compile(
    r"const\s+SCREEN_INDEX\s*=\s*\[.*?\]\s*;",
    re.MULTILINE | re.DOTALL,
)


def upsert_screen_index(html: str, entries: list[dict]) -> tuple[str, bool]:
    """Replace the inline SCREEN_INDEX JS array with the fresh snapshot."""
    if not entries:
        return html, False
    payload = json.dumps(entries, separators=(",", ":"), ensure_ascii=False)
    replacement = f"const SCREEN_INDEX = {payload};"
    new_html, n = _SCREEN_INDEX_RE.subn(replacement, html, count=1)
    if n == 0:
        return html, False
    return new_html, new_html != html


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

# Patterns for the new fields (added 2026-05-08): description / acceptance
# (string), tested / approved (boolean). They live at the task-object level
# (sibling of status/owner). The first `desc` lives inside steps[0].
_DESCRIPTION_RE = re.compile(r'(description\s*:\s*)"((?:[^"\\]|\\.)*)"')
_ACCEPTANCE_RE  = re.compile(r'(acceptance\s*:\s*)"((?:[^"\\]|\\.)*)"')
_TESTED_RE      = re.compile(r'(tested\s*:\s*)(true|false)')
_APPROVED_RE    = re.compile(r'(approved\s*:\s*)(true|false)')
# desc inside steps array — match the FIRST desc field after the task's
# `steps:` keyword. Non-greedy so we don't span across tasks.
_STEP_DESC_RE   = re.compile(r'(steps\s*:\s*\[\s*\{[^}]*?desc\s*:\s*)"((?:[^"\\]|\\.)*)"', re.DOTALL)


def js_string(s: str) -> str:
    """JSON-encode a Python str so it round-trips safely as a JS string literal."""
    return json.dumps(s, ensure_ascii=False)


def parse_owner_literal(raw: str) -> list[str]:
    return [m.group(1) for m in re.finditer(r'"([^"]*)"', raw)]


def render_owner_literal(names: list[str]) -> str:
    return ", ".join(f'"{n}"' for n in names)


def upsert_task_field(text: str, field_name: str, value, anchor_pat=_OWNER_RE) -> tuple[str, bool]:
    """Update or insert `field_name: value` on a task object's first line(s).

    If the field already exists, its value is replaced. Otherwise a new
    field is inserted immediately after the anchor field (default: owner).
    Returns (new_text, changed)."""
    if isinstance(value, bool):
        rendered = "true" if value else "false"
        pat = re.compile(rf'({field_name}\s*:\s*)(true|false)')
    elif isinstance(value, str):
        rendered = js_string(value)
        # NOTE: in raw f-string `\\` is two chars (one literal backslash).
        # Regex needs `[^"\\]` (not-quote-not-backslash) and `\\.` (escaped char).
        # Earlier version used `\\\\` (two literal backslashes) which never
        # matched single-backslash escape sequences — caused INSERT to re-fire
        # every sync, producing duplicates of acceptance/description fields.
        pat = re.compile(rf'({field_name}\s*:\s*)"((?:[^"\\]|\\.)*)"')
    else:
        raise TypeError(f"unsupported value type {type(value)}")

    m = pat.search(text)
    if m:
        # Update in place
        old_full = m.group(0)
        new_full = m.group(1) + rendered
        if old_full == new_full:
            return text, False
        return text[:m.start()] + new_full + text[m.end():], True

    # Insert after the anchor (owner: [...])
    anchor = anchor_pat.search(text)
    if not anchor:
        # Can't anchor; skip silently (task object has unexpected shape)
        return text, False
    insert_at = anchor.end()
    snippet = f",\n    {field_name}: {rendered}"
    return text[:insert_at] + snippet + text[insert_at:], True


def upsert_step_desc(text: str, value: str) -> tuple[str, bool]:
    """Replace the first `desc` field inside the steps array with `value`."""
    rendered = js_string(value)
    m = _STEP_DESC_RE.search(text)
    if not m:
        return text, False
    old_full = m.group(0)
    new_full = m.group(1) + rendered
    if old_full == new_full:
        return text, False
    return text[:m.start()] + new_full + text[m.end():], True


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

        # ─── New fields (added 2026-05-08) ───────────────────────────────
        # description (1-line elevator), acceptance (bulleted criteria),
        # tested + approved (booleans), and refresh `desc` inside steps[0]
        # from the sheet's Detailed Explanation column.

        # Sync the task name from sheet's Title column too — without this,
        # rename in the sheet doesn't propagate to the walkthrough menu.
        sheet_title = (sheet_row.get("Title") or "").strip()
        if sheet_title:
            updated, changed = upsert_task_field(updated, "name", sheet_title)
            if changed:
                changes.append(f"  {task_id}: name → {sheet_title!r}")

        sheet_description = (sheet_row.get("Description") or "").strip()
        if sheet_description:
            updated, changed = upsert_task_field(updated, "description", sheet_description)
            if changed:
                changes.append(f"  {task_id}: description updated")

        sheet_acceptance = (sheet_row.get("Acceptance Criteria") or "").strip()
        if sheet_acceptance:
            updated, changed = upsert_task_field(updated, "acceptance", sheet_acceptance)
            if changed:
                changes.append(f"  {task_id}: acceptance updated")

        # Sheets stores booleans as 'TRUE'/'FALSE' strings; map them.
        def to_bool(v):
            return str(v).strip().upper() == "TRUE"

        sheet_tested = to_bool(sheet_row.get("Tested by Owner") or "")
        updated, changed = upsert_task_field(updated, "tested", sheet_tested)
        if changed:
            changes.append(f"  {task_id}: tested → {sheet_tested}")

        sheet_approved = to_bool(sheet_row.get("Approved by Supervisor") or "")
        updated, changed = upsert_task_field(updated, "approved", sheet_approved)
        if changed:
            changes.append(f"  {task_id}: approved → {sheet_approved}")

        # Refresh step.desc from sheet's Detailed Explanation
        sheet_detailed = (sheet_row.get("Detailed Explanation") or "").strip()
        if sheet_detailed:
            updated, changed = upsert_step_desc(updated, sheet_detailed)
            if changed:
                changes.append(f"  {task_id}: step.desc refreshed")

        new_inner_parts.append(updated)
        cursor = end

    new_inner_parts.append(inner[cursor:])
    new_inner = "".join(new_inner_parts)
    new_html = html[:body_start] + "[" + new_inner + "]" + html[body_end:]

    # Refresh TASK_INDEX (powers the zoom-4 sidebar + jump-to-row) so the
    # embedded snapshot stays current whenever tasks are added, removed,
    # reordered, retitled, or restated in the sheet.
    new_html, task_index_changed = upsert_task_index(new_html, build_task_index(sheet_rows))
    if task_index_changed:
        changes.append("  TASK_INDEX (zoom-4 sidebar) refreshed")

    # Refresh SCREEN_INDEX (powers the zoom-5 Figma sidebar) from the
    # Screens tab. Non-fatal if the tab is missing or empty.
    screen_rows = fetch_screens_rows()
    if screen_rows:
        new_html, screen_index_changed = upsert_screen_index(new_html, build_screen_index(screen_rows))
        if screen_index_changed:
            changes.append("  SCREEN_INDEX (zoom-5 sidebar) refreshed")

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
