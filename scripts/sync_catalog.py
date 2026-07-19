"""Split data/catalog.json into data/albums/<id>.json and rebuild catalog from those files."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "data" / "catalog.json"
ALBUMS_DIR = ROOT / "data" / "albums"


def split_catalog() -> None:
    data = json.loads(CATALOG.read_text(encoding="utf-8"))
    ALBUMS_DIR.mkdir(parents=True, exist_ok=True)
    for album in data.get("albums", []):
        album_id = album["id"]
        path = ALBUMS_DIR / f"{album_id}.json"
        path.write_text(json.dumps(album, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"Wrote {path.relative_to(ROOT)}")


def sync_catalog() -> bool:
    """Merge data/albums/*.json into data/catalog.json. Returns True if file changed."""
    ALBUMS_DIR.mkdir(parents=True, exist_ok=True)
    album_files = sorted(ALBUMS_DIR.glob("*.json"), key=lambda p: p.stem.lower())
    albums = []
    for path in album_files:
        album = json.loads(path.read_text(encoding="utf-8"))
        if not album.get("id"):
            album["id"] = path.stem
        albums.append(album)

    # Stable, readable order by title
    albums.sort(key=lambda a: str(a.get("title", a.get("id", ""))).lower())
    payload = {"albums": albums}
    new_text = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"

    old_text = CATALOG.read_text(encoding="utf-8") if CATALOG.exists() else ""
    if old_text == new_text:
        print("catalog.json already up to date")
        return False

    CATALOG.parent.mkdir(parents=True, exist_ok=True)
    CATALOG.write_text(new_text, encoding="utf-8")
    print(f"Synced {len(albums)} albums -> {CATALOG.relative_to(ROOT)}")
    return True


if __name__ == "__main__":
    import sys

    cmd = sys.argv[1] if len(sys.argv) > 1 else "sync"
    if cmd == "split":
        split_catalog()
        sync_catalog()
    else:
        sync_catalog()
