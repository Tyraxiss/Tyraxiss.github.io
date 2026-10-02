"""Validate the music catalog against the files actually on disk.

Checks (all of these were silent failure modes before):
  * audio ``src`` that does not exist / no audio file for an album folder
  * missing or unresolvable cover art
  * duplicate track ids within an album
  * claimed ``duration`` that disagrees with the real audio length
  * ``lyricsFile`` paths that do not resolve
  * audio on disk that never made it into the catalog

Usage:
    python scripts/validate_catalog.py           # validate data/catalog.json
    python scripts/validate_catalog.py --strict  # warnings become failures

Exits non-zero when errors are found so CI can fail the build.
"""

from __future__ import annotations

import sys
from pathlib import Path

from catalog_lib import (
    CATALOG_PATH,
    ROOT,
    album_folders,
    audio_files,
    normalize_src,
    probe_duration,
    read_json,
)

# Duration drift beyond this many seconds is reported.
DURATION_TOLERANCE = 2

# Cover art below this size is almost certainly a broken placeholder.
MIN_COVER_BYTES = 20_000


def _abs(site_rel: str) -> Path:
    return ROOT.joinpath(*str(site_rel).lstrip("./").split("/"))


def validate(catalog_path: Path = CATALOG_PATH, strict: bool = False) -> int:
    errors: list[str] = []
    warnings: list[str] = []

    if not catalog_path.exists():
        print(f"FAIL: {catalog_path.name} does not exist")
        return 1

    try:
        data = read_json(catalog_path)
    except Exception as exc:
        print(f"FAIL: could not parse {catalog_path.name}: {exc}")
        return 1

    albums = data.get("albums")
    if not isinstance(albums, list):
        print("FAIL: 'albums' must be a list")
        return 1

    seen_album_ids: set[str] = set()
    referenced_srcs: set[str] = set()

    for album in albums:
        album_id = album.get("id") or "<no id>"
        title = album.get("title") or album_id

        if album_id in seen_album_ids:
            errors.append(f"[{album_id}] duplicate album id")
        seen_album_ids.add(album_id)

        # ---- cover art ---------------------------------------------------
        cover = album.get("cover")
        if not cover:
            errors.append(f"[{album_id}] no cover set")
        elif not _abs(cover).exists():
            errors.append(f"[{album_id}] cover not found: {cover}")
        elif _abs(cover).stat().st_size < MIN_COVER_BYTES:
            warnings.append(
                f"[{album_id}] cover art is tiny "
                f"({_abs(cover).stat().st_size // 1024} KB): {cover}"
            )

        tracks = album.get("tracks") or []
        if not tracks:
            warnings.append(f"[{album_id}] has no tracks")

        seen_track_ids: set[str] = set()
        seen_srcs: set[str] = set()

        for track in tracks:
            track_title = track.get("title") or "<untitled>"
            track_id = track.get("id") or "<no id>"
            label = f"[{album_id}] {track_title}"

            if track_id in seen_track_ids:
                errors.append(f"{label}: duplicate track id '{track_id}'")
            seen_track_ids.add(track_id)

            # ---- audio file ----------------------------------------------
            src = track.get("src")
            if not src:
                errors.append(f"{label}: no src set")
                continue

            src_key = normalize_src(src)
            referenced_srcs.add(src_key)
            if src_key in seen_srcs:
                errors.append(f"{label}: src used twice in this album")
            seen_srcs.add(src_key)

            if not _abs(src).exists():
                errors.append(f"{label}: audio file missing: {src}")
                continue

            if not src.startswith("./"):
                warnings.append(f"{label}: src should start with './': {src}")

            claimed = track.get("duration")
            real = probe_duration(_abs(src))
            if real is None:
                warnings.append(f"{label}: could not read duration (ffprobe failed)")
            elif claimed is None:
                warnings.append(f"{label}: no duration set")
            elif abs(real - int(claimed)) > DURATION_TOLERANCE:
                errors.append(
                    f"{label}: duration says {claimed}s but audio is {real}s"
                )

            # ---- lyrics file ---------------------------------------------
            lyrics_file = track.get("lyricsFile")
            if lyrics_file:
                if not _abs(lyrics_file).exists():
                    errors.append(f"{label}: lyricsFile not found: {lyrics_file}")

    # ---- audio on disk that is not in the catalog -----------------------
    for folder in album_folders():
        for path in audio_files(folder):
            key = normalize_src("./" + path.relative_to(ROOT).as_posix())
            if key not in referenced_srcs:
                warnings.append(
                    f"[{folder.name}] audio not in catalog: {path.name}"
                )

    for warning in warnings:
        print(f"warn  {warning}")
    for error in errors:
        print(f"ERROR {error}")

    album_count = len(albums)
    track_count = sum(len(a.get("tracks") or []) for a in albums)
    print(
        f"\n{album_count} albums, {track_count} tracks - "
        f"{len(errors)} error(s), {len(warnings)} warning(s)"
    )

    if errors:
        return 1
    if strict and warnings:
        return 1
    return 0


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    target = Path(args[0]) if args else CATALOG_PATH
    sys.exit(validate(target, strict="--strict" in sys.argv))