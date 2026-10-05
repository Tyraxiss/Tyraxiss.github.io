"""Tests for the catalog pipeline helpers.

Run: python tests/test_catalog.py
"""

from __future__ import annotations

import json
import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from catalog_lib import (  # noqa: E402
    build_catalog_payload,
    normalize_src,
    read_json,
    slugify,
    track_title_from_filename,
    write_json,
)

PASSED = 0
FAILED = 0


def check(label, actual, expected):
    global PASSED, FAILED
    if actual == expected:
        PASSED += 1
    else:
        FAILED += 1
        print(f"FAIL {label}\n  expected {expected!r}\n  actual   {actual!r}")


def test_slugify():
    check("slug plain", slugify("Broken Thoughts"), "broken-thoughts")
    check("slug punctuation", slugify("The Last Of Me!"), "the-last-of-me")
    check("slug accents kept low", slugify("Café Nights"), "caf-nights")
    check("slug leading/trailing", slugify("  Spaced Out  "), "spaced-out")


def test_track_title():
    check("strips hyphen prefix", track_title_from_filename("Brian Smith - Echoes.mp3"), "Echoes")
    check("strips en dash", track_title_from_filename("Brian Smith – Of Sorrow.mp3"), "Of Sorrow")
    check("no prefix", track_title_from_filename("Loose Track.mp3"), "Loose Track")


def test_normalize_src():
    """Two spellings of the same file must compare equal."""
    canonical = normalize_src("./Albums/Broken Thoughts/x.mp3")
    check("vs ./ prefix", normalize_src("Albums/Broken Thoughts/x.mp3"), canonical)
    check("vs leading slash", normalize_src("/Albums/Broken Thoughts/x.mp3"), canonical)
    check("vs legacy prefix", normalize_src("MP3-Website/Albums/Broken Thoughts/x.mp3"), canonical)
    check("vs backslashes", normalize_src(".\\Albums\\Broken Thoughts\\x.mp3"), canonical)
    check("vs url-encoded", normalize_src("./Albums/Broken%20Thoughts/x.mp3"), canonical)
    check("case insensitive", normalize_src("./albums/broken thoughts/X.MP3"), canonical)


def test_write_json_idempotent():
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "out.json"
        payload = {"a": 1}
        check("first write changes", write_json(path, payload), True)
        check("second write is a no-op", write_json(path, payload), False)
        check("content round-trips", read_json(path), payload)
        write_json(path, {"a": 2})
        check("changed write reports", read_json(path), {"a": 2})


def test_payload_sorting():
    payload = build_catalog_payload(
        [{"id": "z", "title": "Zebra"}, {"id": "a", "title": "Apple"}]
    )
    check(
        "albums sorted by title",
        [a["title"] for a in payload["albums"]],
        ["Apple", "Zebra"],
    )


def test_lyrics_files_are_linked_and_usable():
    """Every committed timed lyrics file must be linked to a real catalog track."""
    catalog = read_json(ROOT / "data" / "catalog.json")
    lyrics_root = ROOT / "Albums" / "lyrics"
    linked_paths = {
        str(track.get("lyricsFile", "")).replace("\\", "/").removeprefix("./").lstrip("/")
        for album in catalog.get("albums", [])
        for track in album.get("tracks", [])
        if track.get("lyricsFile")
    }

    lyric_files = sorted(
        path for path in lyrics_root.iterdir() if path.is_file() and path.suffix.lower() in {".lrc", ".vtt"}
    )
    check("timed lyrics files exist", len(lyric_files) > 0, True)

    for path in lyric_files:
        relative = path.relative_to(ROOT).as_posix()
        check(f"{path.name} is linked to a track", relative in linked_paths, True)

        text = path.read_text(encoding="utf-8-sig")
        if path.suffix.lower() == ".lrc":
            lines = [line for line in text.splitlines() if line.strip()]
            check(f"{path.name} has lyrics", bool(lines), True)
            valid = re.compile(r"^\s*\[\d{1,2}:\d{2}(?:[.,]\d+)?\]")
            check(f"{path.name} contains only timestamped lyric lines", all(valid.match(line) for line in lines), True)
        else:
            cue = re.compile(
                r"^\s*(?:\d{2}:)?\d{1,2}:\d{2}(?:[.,]\d+)?\s*-->"
                r"\s*(?:\d{2}:)?\d{1,2}:\d{2}(?:[.,]\d+)?",
                re.MULTILINE,
            )
            check(f"{path.name} has timed cues", bool(cue.search(text)), True)


def test_real_catalog_is_valid():
    """The shipped catalog must satisfy the invariants the player relies on."""
    catalog = read_json(ROOT / "data" / "catalog.json")
    albums = catalog["albums"]
    check("catalog has albums", len(albums) > 0, True)

    total = 0
    for album in albums:
        check(f"{album['id']} has id", bool(album.get("id")), True)
        check(f"{album['id']} has title", bool(album.get("title")), True)
        check(f"{album['id']} has cover", bool(album.get("cover")), True)
        check(
            f"{album['id']} cover has a site-root path",
            album["cover"].startswith(("./", "/")),
            True,
        )

        ids = [t["id"] for t in album["tracks"]]
        check(f"{album['id']} ids unique", len(ids) == len(set(ids)), True)

        for track in album["tracks"]:
            total += 1
            check(f"{track['id']} has title", bool(track.get("title")), True)
            check(f"{track['id']} src starts ./", track["src"].startswith("./"), True)
            check(
                f"{track['id']} duration positive",
                isinstance(track.get("duration"), int) and track["duration"] > 0,
                True,
            )
            if track.get("lyricsFile"):
                check(
                    f"{track['id']} lyricsFile has a site-root path",
                    track["lyricsFile"].startswith(("./", "/")),
                    True,
                )

    check("catalog has tracks", total > 0, True)
    print(f"  (checked {len(albums)} albums / {total} tracks)")


def main() -> int:
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print(f"\n{PASSED} passed, {FAILED} failed")
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())