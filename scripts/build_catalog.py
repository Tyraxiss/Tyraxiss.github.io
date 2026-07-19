import json
import re
import subprocess
from pathlib import Path

root = Path("Albums")
artist = "Brian J. Smith"


def slugify(name: str) -> str:
    s = name.lower().strip()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


def track_title(filename: str) -> str:
    stem = Path(filename).stem
    m = re.match(r"(?i)^brian\s+smith\s*[-–—]\s*(.+)$", stem)
    return m.group(1).strip() if m else stem


def duration_seconds(path: Path) -> int:
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
        ).strip()
        return int(round(float(out)))
    except Exception as e:
        print("duration fail", path, e)
        return 0


def pick_cover(folder: Path) -> str | None:
    preferred = [
        "Album.png",
        "Album.jpg",
        "Album.jpeg",
        "cover.jpg",
        "cover.png",
        f"{folder.name}.png",
        f"{folder.name}.jpg",
    ]
    for name in preferred:
        p = folder / name
        if p.exists():
            return "./" + p.as_posix()
    for p in sorted(folder.iterdir()):
        if p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}:
            return "./" + p.as_posix()
    return None


def main() -> None:
    albums = []
    folders = sorted([p for p in root.iterdir() if p.is_dir()], key=lambda p: p.name.lower())
    for folder in folders:
        cover = pick_cover(folder)
        mp3s = sorted(
            [p for p in folder.iterdir() if p.suffix.lower() == ".mp3"],
            key=lambda p: p.name.lower(),
        )
        album_id = slugify(folder.name)
        tracks = []
        for i, mp3 in enumerate(mp3s, start=1):
            title = track_title(mp3.name)
            tracks.append(
                {
                    "id": f"{album_id}-{i:02d}",
                    "title": title,
                    "duration": duration_seconds(mp3),
                    "src": "./" + mp3.as_posix(),
                    "lyrics": [],
                }
            )
            print(f"{folder.name}: {title} ({tracks[-1]['duration']}s)")

        album = {
            "id": album_id,
            "title": folder.name,
            "artist": artist,
            "cover": cover or f"./Albums/{folder.name}/cover.jpg",
            "tracks": tracks,
        }
        albums.append(album)

    Path("data").mkdir(exist_ok=True)
    Path("data/catalog.json").write_text(
        json.dumps({"albums": albums}, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(
        "Wrote",
        len(albums),
        "albums,",
        sum(len(a["tracks"]) for a in albums),
        "tracks",
    )
    for a in albums:
        print("-", a["title"], "cover=", a["cover"], "tracks=", len(a["tracks"]))


if __name__ == "__main__":
    main()
