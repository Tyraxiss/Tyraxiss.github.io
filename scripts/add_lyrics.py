"""Attach a lyrics file to a track - the fast local path.

Copies an .lrc, enhanced .lrc, .vtt or .srt file into Albums/lyrics/, links it
from the owning data/albums/<id>.json and rebuilds data/catalog.json, then
validates the result. Safe to re-run: it only ever touches one track.

Usage:
    python scripts/add_lyrics.py TRACK FILE [options]

    TRACK   track id (e.g. the-last-of-me-02) or a song title. Titles must be
            unique across the library; ambiguous titles list the candidates.
    FILE    path to the lyrics file (.lrc, .vtt, .srt or .txt)

Options:
    --name NAME    destination filename inside Albums/lyrics (default: the
                   source file's own name)
    --force        overwrite an existing destination file
    --dry-run      report what would happen, write nothing

The browser alternative is the "Test a lyrics file before publishing" card on
admin/lyrics-check.html, which parses a file with the player's own parser.
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from catalog_lib import (  # noqa: E402
    ALBUMS_DIR,
    CATALOG_PATH,
    LYRICS_DIR,
    build_catalog_payload,
    read_json,
    write_json,
)

LYRICS_SUFFIXES = {".lrc", ".vtt", ".srt", ".txt"}


def load_albums() -> list[dict]:
    albums = []
    for path in sorted(ALBUMS_DIR.glob("*.json")):
        album = read_json(path)
        album.setdefault("id", path.stem)
        albums.append(album)
    return albums


def find_track(albums: list[dict], needle: str):
    """Return (album, track) for an id or a unique, case-insensitive title."""
    wanted = needle.strip().lower()
    by_id = [
        (album, track)
        for album in albums
        for track in album.get("tracks", [])
        if str(track.get("id", "")).lower() == wanted
    ]
    if by_id:
        return by_id[0]

    by_title = [
        (album, track)
        for album in albums
        for track in album.get("tracks", [])
        if str(track.get("title", "")).lower() == wanted
    ]
    if len(by_title) == 1:
        return by_title[0]
    if len(by_title) > 1:
        ids = ", ".join(str(t.get("id")) for _, t in by_title)
        raise SystemExit(f"error: title {needle!r} matches several tracks ({ids}); pass the track id instead")
    raise SystemExit(f"error: no track matching {needle!r} (try a track id like the-last-of-me-02)")


def sniff(text: str) -> str:
    """Cheap format check so obviously untimed files are called out."""
    if "WEBVTT" in text[:64].upper() or "-->" in text:
        return "WebVTT / SRT"
    if any(line.lstrip().startswith("[") and ":" in line[:10] for line in text.splitlines()):
        return "LRC"
    return "no timestamps found"


def main(argv: list[str]) -> int:
    argv = list(argv)
    dry_run = "--dry-run" in argv
    force = "--force" in argv

    name_override = None
    if "--name" in argv:
        index = argv.index("--name")
        if index + 1 >= len(argv):
            raise SystemExit("error: --name needs a value")
        name_override = argv[index + 1]
        del argv[index : index + 2]
    else:
        for item in list(argv):
            if item.startswith("--name="):
                name_override = item.split("=", 1)[1]
                argv.remove(item)

    args = [a for a in argv if not a.startswith("-")]

    if len(args) != 2:
        print(__doc__)
        return 2

    track_ref, file_ref = args
    source = Path(file_ref).expanduser()
    if not source.is_file():
        raise SystemExit(f"error: {source} does not exist")
    if source.suffix.lower() not in LYRICS_SUFFIXES:
        raise SystemExit(f"error: expected one of {sorted(LYRICS_SUFFIXES)}, got {source.suffix}")

    albums = load_albums()
    if not albums:
        raise SystemExit("error: no album JSON files in data/albums/")

    album, track = find_track(albums, track_ref)
    dest_name = Path(name_override).name if name_override else source.name
    dest = LYRICS_DIR / dest_name
    site_path = f"./Albums/lyrics/{dest_name}"

    text = source.read_text(encoding="utf-8-sig", errors="replace")
    kind = sniff(text)

    album_path = ALBUMS_DIR / f"{album['id']}.json"
    print(f"track  {track.get('id')} - {track.get('title')} ({album.get('title')})")
    print(f"source {source}")
    print(f"dest   {dest.relative_to(ROOT)} [{kind}]")
    print(f"link   lyricsFile -> {site_path}")

    if kind == "no timestamps found":
        print("  ! no timestamps detected - the player will show it as untimed text")

    if dry_run:
        print("\ndry run - nothing written")
        return 0

    LYRICS_DIR.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.read_bytes() != source.read_bytes() and not force:
        raise SystemExit(f"error: {dest} already exists with different content (use --force to overwrite)")
    if not dest.exists() or dest.read_bytes() != source.read_bytes():
        shutil.copy2(source, dest)
        print(f"  copied -> {dest.relative_to(ROOT)}")

    if track.get("lyricsFile") == site_path:
        print("  already linked")
        return 0

    track["lyricsFile"] = site_path
    write_json(album_path, album)

    # Rebuild the generated catalog from the album JSONs.
    changed = write_json(CATALOG_PATH, build_catalog_payload(albums))
    print(f"catalog.json {'updated' if changed else 'already up to date'}")

    from validate_catalog import validate

    code = validate(CATALOG_PATH)
    if code == 0:
        print("\nDone. Publish the album (or push) and re-check it on admin/lyrics-check.html.")
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
