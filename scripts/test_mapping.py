"""
Unit tests for sheet_html_mapping. Run directly: `python3 test_mapping.py`.
Plain assertions, no test framework dependency.
"""
from sheet_html_mapping import parse_status, parse_stage, parse_owners


def test_parse_status() -> None:
    # Spec cases
    assert parse_status("In Progress", "Stage 2") == "inprogress"
    assert parse_status("Done (no need to change)", "Done") == "done"

    # Status string only
    assert parse_status("In Progress", "") == "inprogress"
    assert parse_status("in progress", "Stage 1") == "inprogress"
    assert parse_status("Blocked", "Stage 3") == "blocked"
    assert parse_status("Done", "Stage 4") == "done"
    assert parse_status("Obsolete", "Stage 1") == "obsolete"

    # Stage column drives done/obsolete even when M is blank
    assert parse_status("", "Done") == "done"
    assert parse_status("", "Obsolete") == "obsolete"

    # Phase 3 only when not done/obsolete
    assert parse_status("", "Phase 3") == "phase3"

    # Empty / unknown → notstarted
    assert parse_status("", "") == "notstarted"
    assert parse_status("Not Started", "Stage 1") == "notstarted"
    assert parse_status("", "Backlog") == "notstarted"

    # Precedence: obsolete > done > blocked > in-progress
    assert parse_status("In Progress", "Done") == "done"
    assert parse_status("Done", "Obsolete") == "obsolete"


def test_parse_stage() -> None:
    assert parse_stage("Stage 1") == 1
    assert parse_stage("Stage 2") == 2
    assert parse_stage("Stage 3") == 3
    assert parse_stage("Stage 4") == 4
    assert parse_stage("Stage 5") == 5
    assert parse_stage("  Stage 3  ") == 3
    assert parse_stage("stage 2") == 2

    # Don't sync these — return None
    assert parse_stage("") is None
    assert parse_stage("Done") is None
    assert parse_stage("Obsolete") is None
    assert parse_stage("Phase 3") is None
    assert parse_stage("Backlog") is None
    assert parse_stage("Stage 6") is None
    assert parse_stage("Stage") is None


def test_parse_owners() -> None:
    # Spec cases
    assert parse_owners("mintesnotm + alejandro") == ["Mint", "Alejandro"]
    assert parse_owners("TBD") == []
    assert parse_owners("yonas (handle TBD)") == ["Yonas"]

    # Single handle
    assert parse_owners("mintesnotm") == ["Mint"]
    assert parse_owners("amit25") == ["Amit"]

    # Plus variants
    assert parse_owners("mintesnotm+alejandro") == ["Mint", "Alejandro"]
    assert parse_owners("mintesnotm  +  alejandro") == ["Mint", "Alejandro"]

    # Three-way
    assert parse_owners("mintesnotm + yonas + alejandro") == ["Mint", "Yonas", "Alejandro"]

    # Dedup: same person via different handle aliases
    assert parse_owners("alejandro + alej4ndro") == ["Alejandro"]

    # Empty / skip tokens
    assert parse_owners("") == []
    assert parse_owners("   ") == []
    assert parse_owners("(prior team)") == []
    assert parse_owners("tbd") == []

    # Mixed: real handle + TBD → real handle only (TBD is the SKIP token)
    assert parse_owners("mintesnotm + TBD") == ["Mint"]

    # Unknown handle is dropped, callback fires
    seen_unknown: list[str] = []
    out = parse_owners("mintesnotm + somerandomhandle", on_unknown=seen_unknown.append)
    assert out == ["Mint"], out
    assert seen_unknown == ["somerandomhandle"], seen_unknown


def main() -> None:
    tests = [test_parse_status, test_parse_stage, test_parse_owners]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"  ✓  {t.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"  ✗  {t.__name__}: {e}")
    if failed:
        print(f"\n{failed} test(s) failed")
        raise SystemExit(1)
    print(f"\n{len(tests)} test(s) passed")


if __name__ == "__main__":
    main()
