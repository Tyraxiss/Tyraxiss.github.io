"""Shared helpers for reading/writing catalog data.

The single source of truth for album metadata is ``data/albums/<id>.json``
(what the Sveltia CMS edits). ``data/catalog.json`` is a generated merge of
those files that the public player fetches.

Nothing in here may ever discard lyrics or lyric files: build_catalog.py reads
album metadata from the CMS-owned JSON files and only *overlays* facts that can
be measured from disk (durations, cover art, which audio files exist).
"""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "data" / "catalog.json"
ALBUMS_DIR = ROOT / "data" / "albums"
ALBUMS_ROOT = ROOT / "Albums"

# Folders inside Albums/ that hold uploads rather than album audio.
SKIP_ALBUM_DIRS = {"lyrics"}

AUDIO_EXTENSIONS = {".mp3", ".m4a", ".aac", ".ogg", ".oga", ".opus", ".wav"}

COVER_PREFERRED = [
    "Album.png",
    "Album.jpg",
    "Album.jpeg",
    "cover.jpg",
    "cover.png",
    "cover.jpeg",
]
COVER_FALLBACK_EXTS = {".png", ".jpg", ".jpeg", ".webp"}

ARTIST_DEFAULT = "Brian J. Smith"


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: dict) -> bool:
    """Write payload as pretty JSON. Returns True when the file changed."""
    text = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    old = path.read_text(encoding="utf-8") if path.exists() else ""
    if old == text:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return True


def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", str(name).lower().strip())
    return slug.strip("-")


def site_path(path: Path) -> str:
    """Absolute path -> site-relative './Albums/...' string with forward slashes."""
    return "./" + path.relative_to(ROOT).as_posix()


def normalize_src(value: str) -> str:
    """Compare src values regardless of './', backslashes or URL-encoding."""
    if not value:
        return ""
    text = str(value).replace("\\", "/").strip()
    text = re.sub(r"^(?:\./)?(?:MP3-Website/)?", "", text)
    text = text.lstrip("/")
    try:
        text = "/".join(unquote_seg(seg) for seg in text.split("/") if seg)
    except Exception:
        pass
    return text.lower()


def unquote_seg(seg: str) -> str:
    from urllib.parse import unquote

    return unquote(seg)


def track_title_from_filename(filename: str) -> str:
    stem = Path(filename).stem
    match = re.match(r"(?i)^brian\s+smith\s*[-–—]\s*(.+)$", stem)
    return match.group(1).strip() if match else stem


def probe_duration(path: Path):
    """Seconds from ffprobe, or None when unavailable (ffprobe missing/failed)."""
    try:
        out = subprocess.check_output(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(path),
            ],
            text=True,
            stderr=subprocess.DEVNULL,
            timeout=60,
        ).strip()
        return int(round(float(out)))
    except Exception:
        return None


def album_folders():
    """Album directories on disk, excluding upload folders."""
    if not ALBUMS_ROOT.is_dir():
        return []
    return sorted(
        (
            p
            for p in ALBUMS_ROOT.iterdir()
            if p.is_dir() and p.name.lower() not in SKIP_ALBUM_DIRS
        ),
        key=lambda p: p.name.lower(),
    )


def audio_files(folder: Path):
    return sorted(
        (p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in AUDIO_EXTENSIONS),
        key=lambda p: p.name.lower(),
    )


def pick_cover(folder: Path):
    """Best cover image for an album folder, as a site-relative path or None."""
    for name in COVER_PREFERRED:
        candidate = folder / name
        if candidate.is_file():
            return site_path(candidate)
    for ext in sorted(COVER_FALLBACK_EXTS):
        found = sorted(folder.glob(f"*{ext}"))
        if found:
            return site_path(found[0])
    return None


def build_catalog_payload(albums) -> dict:
    ordered = sorted(albums, key=lambda a: str(a.get("title") or a.get("id") or "").lower())
    return {"albums": ordered}