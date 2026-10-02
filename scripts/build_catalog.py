"""Reconcile data/albums/*.json with the real audio in Albums/.

Safe to run at any time: album metadata, lyrics and lyric files always come
from the CMS-owned JSON files. Only measurable facts from disk are overlaid:

  * ``duration`` - always re-stamped from ffprobe when the file is readable
  * ``cover``    - refreshed when the current cover no longer exists
  * ``src``      - new audio files on disk are added as new tracks
  * ``title``    - filled in from the filename for brand-new tracks

Tracks whose audio file has disappeared are reported and dropped from the
catalog, but lyrics are never discarded from the JSON.

Usage:
    python scripts/build_catalog.py            # report + rewrite JSON
    python scripts/build_catalog.py --dry-run  # report only, write nothing
"""

from __future__ import annotations

import json
import sys

from catalog_lib import (
    ALBUMS_DIR,
    CATALOG_PATH,
    ROOT,
    album_folders,
    audio_files,
    build_catalog_payload,
    normalize_src,
    pick_cover,
    probe_duration,
    read_json,
    site_path,
    slugify,
    track_title_from_filename,
    write_json,
)


def load_existing_albums() -> dict:
    """Existing album JSON keyed by album id."""
    albums: dict = {}
    if not ALBUMS_DIR.is_dir():
        return albums
    for path in sorted(ALBUMS_DIR.glob("*.json")):
        try:
            album = read_json(path)
        except json.JSONDecodeError as exc:
            print(f"  ! {path.name} is not valid JSON ({exc}) - skipped")
            continue
        album["id"] = album.get("id") or path.stem
        albums[album["id"]] = album
    return albums


def abs_path(site_rel: str) -> Path:
    """'./Albums/x/y.mp3' -> absolute Path under ROOT (works on Windows + POSIX)."""
    return ROOT.joinpath(*str(site_rel).lstrip("./").split("/"))


def reconcile_album(album: dict, folder, dry_run: bool):
    """Overlay disk facts onto one album. Returns (album, notes)."""
    notes = []
    album = dict(album)
    album.setdefault("artist", "Brian J. Smith")

    disk_cover = pick_cover(folder)
    current_cover = album.get("cover")
    if not current_cover and disk_cover:
        album["cover"] = disk_cover
        notes.append(f"cover set -> {disk_cover}")
    elif current_cover and not abs_path(current_cover).exists():
        if disk_cover:
            album["cover"] = disk_cover
            notes.append(f"cover missing, repointed -> {disk_cover}")
        else:
            notes.append(f"!! no cover image found in {folder.name}")

    existing = list(album.get("tracks") or [])
    on_disk = audio_files(folder)
    disk_srcs = {normalize_src(site_path(p)) for p in on_disk}

    tracks = []
    kept = set()
    for track in existing:
        key = normalize_src(track.get("src", ""))
        if key and key in disk_srcs:
            real = probe_duration(abs_path(track["src"]))
            new = dict(track)
            if real is not None and new.get("duration") != real:
                notes.append(
                    f"duration {new.get('duration')} -> {real}s : {new.get('title')}"
                )
                new["duration"] = real
            tracks.append(new)
            kept.add(key)

    added = 0
    for path in on_disk:
        key = normalize_src(site_path(path))
        if key in kept:
            continue
        real = probe_duration(path)
        title = track_title_from_filename(path.name)
        tracks.append(
            {
                "id": "",
                "title": title,
                "duration": real if real is not None else 0,
                "src": site_path(path),
                "lyrics": "",
            }
        )
        added += 1
        notes.append(f"new track added: {title} ({real}s)")

    if added:
        tracks.sort(key=lambda t: str(t.get("src", "")).lower())

    # Keep the ids the CMS already assigned - they are the stable identity a
    # track keeps even when new songs shift its position. Only brand-new
    # tracks get a fresh id, and genuinely duplicated ids are repaired.
    album_id = album["id"]
    used_ids = set()
    for track in tracks:
        track_id = str(track.get("id") or "")
        if not track_id or track_id in used_ids or not track_id.startswith(album_id):
            track_id = ""
        else:
            used_ids.add(track_id)
        track["id"] = track_id

    for index, track in enumerate(tracks, start=1):
        if track["id"]:
            continue
        candidate = f"{album_id}-{index:02d}"
        while candidate in used_ids:
            index += 1
            candidate = f"{album_id}-{index:02d}"
        track["id"] = candidate
        used_ids.add(candidate)

    # Report only real duplicates in the source data.
    original_ids = [str(t.get("id") or "") for t in existing]
    for track_id in sorted({i for i in original_ids if original_ids.count(i) > 1}):
        notes.append(f"!! duplicate track id in source data: {track_id}")

    for track in existing:
        key = normalize_src(track.get("src", ""))
        if key and key not in disk_srcs:
            notes.append(f"!! audio missing, track dropped: {track.get('title')}")

    album["tracks"] = tracks
    if not dry_run:
        write_json(ALBUMS_DIR / f"{album_id}.json", album)
    return album, notes


def main() -> int:
    dry_run = "--dry-run" in sys.argv
    print("== Reconciling Albums/ with data/albums/ ==")
    if dry_run:
        print("(dry run - nothing written)")

    existing = load_existing_albums()
    matched = set()
    albums = []
    problems = 0

    for folder in album_folders():
        album_id = slugify(folder.name)
        album = existing.get(album_id)
        if album is None:
            print(f"\n{folder.name}: no JSON yet - creating from disk")
            album = {"id": album_id, "title": folder.name, "tracks": []}
        matched.add(album_id)

        album, notes = reconcile_album(album, folder, dry_run)
        albums.append(album)
        print(f"\n{folder.name} ({album['id']}) - {len(album['tracks'])} tracks")
        for note in notes:
            if note.startswith("!!"):
                problems += 1
            print(f"  {note}")

    for album_id in sorted(set(existing) - matched):
        albums.append(existing[album_id])
        print(f"\n{album_id}: no folder in Albums/ - kept JSON as-is")

    if not dry_run:
        changed = write_json(CATALOG_PATH, build_catalog_payload(albums))
        print(f"\ncatalog.json {'updated' if changed else 'already up to date'}")

    print(f"\n{len(albums)} albums, {sum(len(a['tracks']) for a in albums)} tracks")
    if problems:
        print(f"{problems} problem(s) need attention")
    return 0


if __name__ == "__main__":
    sys.exit(main())
