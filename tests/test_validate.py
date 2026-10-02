"""Negative tests: prove validate_catalog.py actually catches broken data.

A validator that only ever passes is worthless, so this feeds it deliberately
broken catalogs and asserts the specific errors come back.

Run: python tests/test_validate.py
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from validate_catalog import validate  # noqa: E402

PASSED = 0
FAILED = 0


def check(label, condition):
    global PASSED, FAILED
    if condition:
        PASSED += 1
    else:
        FAILED += 1
        print(f"FAIL {label}")


def run(payload):
    """Validate a payload; return (exit_code, combined_output)."""
    import io
    import contextlib

    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "catalog.json"
        path.write_text(json.dumps(payload), encoding="utf-8")
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            code = validate(path)
        return code, buffer.getvalue()


def track(**over):
    # Duration must match the real file (243s) or the validator correctly fails.
    base = {
        "id": "a-01",
        "title": "Song",
        "duration": 243,
        "src": "./Albums/Misc. Song/Brian Smith - Electric Night Run.mp3",
        "lyrics": "",
    }
    base.update(over)
    return base


def album(**over):
    base = {
        "id": "a",
        "title": "Album",
        "artist": "Brian J. Smith",
        "cover": "./Albums/Misc. Song/cover.jpg",
        "tracks": [track()],
    }
    base.update(over)
    return base


def main() -> int:
    good = {"albums": [album()]}

    # ---- baseline: a valid catalog passes
    code, out = run(good)
    check("valid catalog exits 0", code == 0)
    check("valid catalog has no ERROR lines", "ERROR" not in out)

    # ---- audio src pointing at a file that does not exist
    code, out = run({"albums": [album(tracks=[track(src="./Albums/Nope/gone.mp3")])]})
    check("missing audio is an error", code == 1)
    check("missing audio is reported", "audio file missing" in out)

    # ---- missing cover
    code, out = run({"albums": [album(cover="./Albums/Nope/cover.jpg")]})
    check("missing cover is an error", code == 1)
    check("missing cover is reported", "cover not found" in out)

    # ---- duplicate track id inside one album
    code, out = run(
        {"albums": [album(tracks=[track(id="a-01"), track(id="a-01", title="Other")])]}
    )
    check("duplicate track id is an error", code == 1)
    check("duplicate track id is reported", "duplicate track id" in out)

    # ---- duration that lies about the audio
    code, out = run({"albums": [album(tracks=[track(duration=999)])]})
    check("wrong duration is an error", code == 1)
    check("wrong duration is reported", "duration says" in out)

    # ---- broken lyricsFile path
    code, out = run({"albums": [album(tracks=[track(lyricsFile="./Albums/lyrics/nope.lrc")])]})
    check("broken lyricsFile is an error", code == 1)
    check("broken lyricsFile is reported", "lyricsFile not found" in out)

    # ---- duplicate album id
    code, out = run({"albums": [album(), album()]})
    check("duplicate album id is an error", code == 1)
    check("duplicate album id is reported", "duplicate album id" in out)

    # ---- malformed payloads
    code, out = run({"albums": "not-a-list"})
    check("non-list albums exits 1", code == 1)

    code, out = run({})
    check("missing albums key exits 1", code == 1)

    print(f"\n{PASSED} passed, {FAILED} failed")
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())