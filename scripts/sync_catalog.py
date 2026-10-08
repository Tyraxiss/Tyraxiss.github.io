"""Merge data/albums/*.json into data/catalog.json (and back again).

catalog.json is generated output. The CMS edits data/albums/<id>.json; this
script merges those files so the public player can fetch one document.

Commands:
    python scripts/sync_catalog.py sync     # albums/*.json -> catalog.json
    python scripts/sync_catalog.py split    # catalog.json -> albums/*.json
    python scripts/sync_catalog.py validate # report problems, non-zero on error

To refresh durations/cover art from the real audio files, run
`python scripts/build_catalog.py` instead - it is safe and never drops lyrics.
"""

from __future__ import annotations

import sys

from catalog_lib import (
    ALBUMS_DIR,
    CATALOG_PATH,
    build_catalog_payload,
    read_json,
    write_json,
)
from validate_catalog import validate


def split_catalog() -> None:
    data = read_json(CATALOG_PATH)
    ALBUMS_DIR.mkdir(parents=True, exist_ok=True)
    for album in data.get("albums", []):
        album_id = album["id"]
        path = ALBUMS_DIR / f"{album_id}.json"
        write_json(path, album)
        print(f"Wrote {path.name}")


def sync_catalog() -> None:
    """Merge data/albums/*.json into data/catalog.json.

    Returns nothing on purpose: main() maps a truthy return to a non-zero exit
    code, so returning "changed" here used to make CI fail *because* it did
    real work - and the commit step never ran.
    """
    ALBUMS_DIR.mkdir(parents=True, exist_ok=True)
    album_files = sorted(ALBUMS_DIR.glob("*.json"), key=lambda p: p.stem.lower())
    albums = []
    for path in album_files:
        album = read_json(path)
        if not album.get("id"):
            album["id"] = path.stem
        albums.append(album)

    changed = write_json(CATALOG_PATH, build_catalog_payload(albums))
    if changed:
        print(f"Synced {len(albums)} albums -> catalog.json")
    else:
        print("catalog.json already up to date")


COMMANDS = {
    "sync": sync_catalog,
    "split": split_catalog,
    "validate": lambda: validate(CATALOG_PATH),
}


def main() -> int:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "sync"
    handler = COMMANDS.get(cmd)
    if handler is None:
        print(f"Unknown command '{cmd}'. Use one of: {', '.join(COMMANDS)}")
        return 2
    result = handler()
    # Only handlers that return an int (validate) can fail the command.
    return result if isinstance(result, int) else 0


if __name__ == "__main__":
    sys.exit(main())
