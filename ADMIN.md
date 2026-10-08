# Manage your music library (Pages CMS)

The public player reads the generated [`data/catalog.json`](data/catalog.json). Album metadata, track order, and lyric links remain in the existing [`data/albums/*.json`](data/albums/) files. Pages CMS is a GitHub-backed editor for those same JSON files; it does not replace the website, player, or catalog pipeline.

**Your live site:** https://tyraxiss.github.io/
**Library admin page:** https://tyraxiss.github.io/admin/
**Pages CMS:** https://app.pagescms.org/

## First-time setup

1. Open [Pages CMS](https://app.pagescms.org/) and sign in with GitHub.
2. Install/authorize the Pages CMS GitHub App for the account that owns `Tyraxiss/Tyraxiss.github.io`. Grant access to this repository. Pages CMS uses its GitHub App for sign-in and repository changes; no personal access token, OAuth worker, Cloudflare service, or secret in this repository is needed.
3. Open `Tyraxiss/Tyraxiss.github.io` and select the `main` branch.
4. Pages CMS reads the root [`.pages.yml`](.pages.yml) configuration. Choose **Music Library** to search albums by title, artist, or year.
5. Open an album to edit its metadata and artwork. The ordered track list is an array stored inside that album's JSON; expand a track to update its title, audio, duration, or lyrics.

If the repository is not listed, check that you signed in with the GitHub account that owns it and installed the Pages CMS GitHub App with access to the repository. Configuration changes take effect when Pages CMS reloads the repository/branch.

## What the CMS edits

- Album documents: `data/albums/<album-id>.json` (one JSON document per album).
- Artwork and audio: files under each album's existing `Albums/<Album Name>/` folder.
- Synchronized lyrics: files under `Albums/lyrics/`.
- Generated public catalog: `data/catalog.json` is rebuilt by the existing automation; do not edit it as the source of truth.

The JSON model stays as it is. In particular, `duration` remains present on tracks because the catalog builder refreshes it from the real audio using FFmpeg/ffprobe, and the player and validation tests rely on it. The generated catalog normalizes media paths for the player; no site URL, content layout, or player migration is part of this CMS change.

## Editing albums, tracks, and lyrics

1. In Pages CMS, open **Music Library**, search for an album, and open it.
2. Edit the album title, artist, year, and cover as needed. Keep its stable album ID aligned with its JSON filename and matching folder under `Albums/`.
3. Expand a row in **Ordered tracks** to edit that track. Track order in this list is playback order. Keep existing track IDs unchanged; for a new track, the build can assign an ID when left blank.
4. Select the matching audio file under that album's `Albums/<Album Name>/` folder. Upload new audio there rather than to the repository root or the lyrics directory.
5. For synchronized lyrics, select or upload the matching `.lrc`, `.vtt`, or `.srt` file under `Albums/lyrics/`. The public player supports line-timed LRC, enhanced LRC word timing, WebVTT cues/inline timestamps, and SRT. Leave plain lyrics empty when a timed file is attached.
6. For unsynchronized lyrics, leave the lyrics-file field empty and use **Plain lyrics (fallback)**.
7. Save/commit the changes in Pages CMS. GitHub Actions rebuilds and validates the catalog; after that, GitHub Pages publishes the update.
8. Check the published files at [`/admin/lyrics-check.html`](https://tyraxiss.github.io/admin/lyrics-check.html): run **Check linked lyrics** and use the file preview before publishing new lyric files.

Uploaded audio/art belongs in `Albums/`; lyric uploads belong in `Albums/lyrics/`. Keep individual MP3s under **100 MB** (Git LFS does not work with GitHub Pages).

## The existing safety pipeline

The CMS changes only the editing interface. The repository workflow keeps its existing checks: Python and Node setup, FFmpeg installation, catalog tests, audio/JSON reconciliation, catalog validation, player logic tests, browser-based lyrics/playback checks, mobile layout audit, and automatic commit of regenerated catalog data. The workflow also watches `.pages.yml`, so configuration edits run the same checks. Do not bypass or remove these checks when editing CMS configuration.

## Local preview, rebuild, and validation

Serve the website over HTTP (rather than opening a raw `file://` path):

```bash
node tests/serve.cjs 8765
```

This server answers HTTP Range requests (206) the way GitHub Pages does, so seeking works. `python -m http.server` does not provide the required range behavior for media.

When adding audio directly to an album directory, run the reconciler. It discovers new tracks, assigns IDs, refreshes durations and cover art, and preserves existing lyrics:

```bash
python scripts/build_catalog.py
python scripts/build_catalog.py --dry-run  # preview without writing
```

If only album JSON metadata was edited, rebuild the generated catalog with:

```bash
python scripts/sync_catalog.py sync
```

Validate media and metadata with:

```bash
python scripts/validate_catalog.py
python scripts/validate_catalog.py --strict  # warnings also fail
```

The same core validation runs automatically in CI before publication.

## Supported lyric formats

| Format | Timing | Karaoke |
|---|---|---|
| LRC `[00:12.34] words` | Line-by-line | Line highlight |
| Enhanced LRC `[00:12.34]<00:12.50>word` | Line and word | Word-by-word |
| WebVTT cues (optional inline `<00:00:12.500>` stamps) | Line and word | Line or word-by-word |
| SRT (`00:00:12,500 --> ...`) | Line-by-line | Line highlight |
| Plain text | None | Static lyrics |

The public player and lyrics tools share [`js/lyrics.js`](js/lyrics.js), so files that parse in the preview use the same parser as playback.

## Adding or checking lyrics from the command line

The normal workflow is to preview the file at `admin/lyrics-check.html`, then upload/select it in Pages CMS and link it to its track. The helper script is also available:

```bash
python scripts/add_lyrics.py the-last-of-me-02 "~/Downloads/song.lrc"
```

It copies the file into `Albums/lyrics/`, links it on that track, rebuilds `data/catalog.json`, and validates. Use `--name other.lrc` to choose a destination filename, or `--dry-run` to preview. Titles work too when unique.

Tests can be run locally with:

```bash
python tests/test_catalog.py
python tests/test_validate.py
node tests/app-logic.test.js
npm run test:browser  # requires the local range-capable server and Puppeteer/Chrome
```

## Repository size

Audio is committed straight into git (LFS is not an option on Pages), so the repository grows with every track. GitHub warns above 1 GB and hard-blocks at 5 GB. If it approaches that warning, consider lowering the bitrate for new uploads or hosting audio externally and pointing `src` at a CDN URL. Re-encoding existing files in place is lossy-to-lossy and permanently degrades the masters.
