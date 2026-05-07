"""
Data contract: Google Master Sheet (Tasks tab) → architecture map HTML.

Pure functions, no I/O. Reusable for future bidirectional sync.
"""
from __future__ import annotations

import re
from typing import Optional

# GitLab/Mattermost handle → display name shown in the architecture map.
# Anyone not in this dict gets logged as a warning and skipped.
# "(prior team)", "TBD", and empty values produce an empty owner list.
HANDLE_TO_NAME: dict[str, str] = {
    "mintesnotm": "Mint",
    "amit25":     "Amit",       # legacy
    "yonas":      "Yonas",
    "imsaidm":    "Said",       # legacy
    "alejandro":  "Alejandro",
    "alej4ndro":  "Alejandro",
    "timothy":    "Timothy",
    "timothyjm":  "Timothy",
    "yair":       "Yair",
}

# Tokens that are explicitly "no real owner" — produce empty list, no warning.
SKIP_HANDLE_TOKENS: set[str] = {
    "tbd",
    "(prior team)",
    "prior team",
}

# Status values consumed by the HTML.
STATUS_NOTSTARTED = "notstarted"
STATUS_INPROGRESS = "inprogress"
STATUS_BLOCKED    = "blocked"
STATUS_DONE       = "done"
STATUS_OBSOLETE   = "obsolete"
STATUS_PHASE3     = "phase3"


def parse_status(internal_status: str, stage: str) -> str:
    """
    Sheet col M (Internal Status) + col R (Stage) → HTML status string.

    Precedence: obsolete > done > blocked > in-progress > phase3 > default.
    "Done (no need to change)" → done. Empty cells → notstarted.
    """
    m = (internal_status or "").strip().lower()
    s = (stage or "").strip().lower()

    if "obsolete" in m or "obsolete" in s:
        return STATUS_OBSOLETE
    if "done" in m or "done" in s:
        return STATUS_DONE
    if "blocked" in m:
        return STATUS_BLOCKED
    if "in progress" in m:
        return STATUS_INPROGRESS
    if "phase 3" in s:
        return STATUS_PHASE3
    return STATUS_NOTSTARTED


# Matches "Stage 1" through "Stage 5", case-insensitive, tolerant of whitespace.
_STAGE_RE = re.compile(r"^\s*stage\s*([1-5])\s*$", re.IGNORECASE)


def parse_stage(stage: str) -> Optional[int]:
    """
    Sheet col R (Stage) → int 1–5, or None if the row should be skipped
    (Done / Obsolete / Phase 3 / Backlog / blank / unrecognized).

    None means "leave HTML stage as-is" — sync caller must not write it.
    """
    if not stage:
        return None
    match = _STAGE_RE.match(stage)
    if not match:
        return None
    return int(match.group(1))


def parse_owners(assignee: str, *, on_unknown=None) -> list[str]:
    """
    Sheet col D (Assignee) → ordered list of display names, deduplicated.

    Splits on "+" (with optional surrounding whitespace).
    Empty input, "TBD", and "(prior team)" → []. Unknown handles trigger
    on_unknown(handle) callback (defaults to no-op) and are skipped.
    """
    raw = (assignee or "").strip()
    if not raw:
        return []
    if raw.lower() in SKIP_HANDLE_TOKENS:
        return []

    seen: set[str] = set()
    out: list[str] = []
    for token in re.split(r"\s*\+\s*", raw):
        t = token.strip()
        if not t:
            continue
        # Strip parenthetical aside, e.g. "yonas (handle TBD)" → "yonas"
        bare = re.sub(r"\s*\(.*?\)\s*", "", t).strip().lower()
        if not bare or bare in SKIP_HANDLE_TOKENS:
            continue
        name = HANDLE_TO_NAME.get(bare)
        if name is None:
            if on_unknown is not None:
                on_unknown(t)
            continue
        if name not in seen:
            seen.add(name)
            out.append(name)
    return out
