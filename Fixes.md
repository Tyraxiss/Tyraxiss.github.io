# Fixes — status

Everything from the original audit, and what happened to it.
Current state: **5 albums / 66 tracks, validator clean (0 errors).**

## Done

### Data pipeline (the real risk)

- **Lyrics can no longer be destroyed.** `build_catalog.py` used to rebuild
  `catalog.json` from scratch and hardcode `"lyrics": ""`. It now reads album
  metadata from the CMS-owned `data/albums/*.json` and only *overlays* what it
  can measure from disk (durations, cover art, which audio exists). Running it
  twice is a no-op and never touches lyric text.
- **Durations are stamped from reality.** `Morbid Thoughts` claimed 195s but is
  really 290s — a 95-second lie. All 66 tracks now carry the ffprobe value, and
  `build_catalog.py` re-stamps them on every run.
- **Validation exists and CI enforces it.** `scripts/validate_catalog.py` fails
  on missing audio, missing cover art, duplicate track ids, wrong durations and
  broken `lyricsFile` paths. CI runs it after every rebuild, so a broken catalog
  cannot reach the live site.
- **`Dreams Realized` cover was broken.** `Album.png` had been deleted while the
  catalog still pointed at it. Repointed to `Dreams Realized.jpg`.
- **Path format is consistent.** `lyricsFile` now uses the same `./Albums/...`
  prefix as everything else.
- **CI triggers fixed.** The workflow ignored `scripts/build_catalog.py` and
  `Albums/**`, so changes there were never tested. Added both, plus
  `workflow_dispatch` and an ffmpeg step (validation needs `ffprobe`).

### Player

- **Audio errors are handled.** A missing or undecodable MP3 used to leave the
  player silently stalled; it now toasts the reason and skips to the next track.
- **Volume persists** across visits (was hardcoded to 0.85 on every load).
- **Playback position persists** — saved on pause / tab-hide / exit, with a
  dismissable "Resume … at 3:12?" card on return. It won't offer to resume a
  track that had effectively finished.
- **Keyboard shortcuts:** `Space` play/pause, `←/→` seek ±5s, `Ctrl+←/→` track,
  `↑/↓` volume, `S` shuffle, `R` repeat, `L` lyrics, `Esc` close. Ignored while
  typing in a field.
- **Play All / Shuffle** buttons in the album header.
- **Shuffle no longer repeats itself** — it keeps a bag of played tracks and
  only reshuffles once the whole album has been heard. `prev` steps back
  through that history.
- **Queue / "play next"** — the `+` on a track row queues it across albums; the
  queue is consumed before normal next-track order.
- **Per-track download links** (plain `download` attribute, no backend).
- **Search** filters the album grid live by album, artist, year or track title.
- **Dynamic page title** reflects the playing track.
- **Loading skeleton** while `catalog.json` fetches, instead of a blank view.

### Library content

- **3 new tracks added** to *The Last Of Me* (Blue-Eyed Angel, Morbid Thoughts
  (Downtrodden), Still Here) — 13 → 16, catalog rebuilt.
- **Unused MP4s removed** (3 files, ~6.9 MB) and confirmed referenced nowhere.

- **Mobile: play/pause was cut off at the bottom.** On phones the app shell is a
  three-row grid (topbar / content / player). The bottom row (the player) was
  pushed below the fold and clipped by the browser chrome, which is what the
  screenshot showed. Measured against the live site: on an iPhone SE the play
  button's bottom sat at **687px inside a 667px viewport**, and the document
  scrolled 749px — i.e. the player was genuinely off-screen, not just tight.
  The shipped fix is the mobile layout in `css/style.css` (the `@media
  (max-width: 900px)` block relaxes `--player-h` to `auto`, lets the content row
  shrink via `min-height: 0`, and pads for `env(safe-area-inset-bottom)`), plus
  `viewport-fit=cover` in `index.html`. Verified against six emulated devices.
- **`tests/mobile.cjs`** — 54 layout checks across six real device sizes (iPhone
  SE/12, Pixel 5, Galaxy S8+, small landscape, tablet) asserting the player bar,
  play button and transport row stay inside the viewport, with no page or
  horizontal overflow, on both the home grid and the album view. It also asserts
  a ≥40px tap target. Run it against any URL to reproduce:
  `node tests/mobile.cjs https://tyraxiss.github.io/`.
  This same audit is wired into CI as a separate `layout` job, so the player bar
  cannot silently regress below the fold again.

### Hygiene

- `.gitignore` now covers `__pycache__/`, `*.pyc`, `node_modules/` and local
  test screenshots.
- Mobile safe-area fix (`env(safe-area-inset-bottom)`, `viewport-fit=cover`).
- Inline SVG favicon added — was a 404 on every page load.
- Admin link toned down to an icon so visitors aren't prompted to sign in.

### Tests added

- `tests/app-logic.test.js` — 36 checks against the real shipped functions (LRC
  and VTT parsing, URL encoding, XSS escaping, shuffle, repeat, search).
- `tests/test_catalog.py` — 244 checks on the pipeline and shipped catalog.
- `tests/test_validate.py` — 16 checks proving the validator *catches* things.
- `tests/smoke.cjs` — 22 end-to-end checks driving a real browser.

## Still open

- **Album years set:** 2025 for *Broken Thoughts*, *Dreams Realized*,
  *Misc. Song* and *Thoughts Distilled*; 2026 for *The Last Of Me*. Shown in the
  home grid ("11 tracks · 2025") and the album hero, and searchable.
- **`Misc. Song/cover.jpg` is 9 KB** vs 1.5–2.7 MB for the other covers, so it
  will look blurry in the grid. Needs a real replacement image.
- **Lyrics: 16 of 66 tracks linked** (was 1). The karaoke feature works; the
  rest is content work — paste lyrics in the CMS or add `.lrc` / enhanced `.lrc`
  / `.vtt` / `.srt` files.
- **Enhanced LRC support was missing.** Files with word-level `<00:14.004>` tags
  used to print those tags on screen. `js/lyrics.js` now parses plain LRC,
  enhanced LRC, WebVTT (incl. inline word stamps) and SRT, and karaoke highlights
  word by word when timings exist.
- **Repo size ~490 MB.** Deliberately left alone (decision: keep audio
  quality). GitHub warns at 1 GB and hard-blocks at 5 GB; there's room for
  roughly 4–5 more albums. Guidance is in `ADMIN.md`.

## Confirmed intentional

- **Repeated song titles across albums are deliberate variants** — "Ravens
  Wings" (*Dreams Realized* / *Thoughts Distilled*), "This Ground Holds"
  (*Dreams Realized* / *The Last Of Me*), "Truth or Lies" (*Broken Thoughts* /
  *The Last Of Me*). Left exactly as they are; the `(Revised)` / `(Realized)`
  suffixes that distinguish them are correct.

## Dropped from the original list

"Eliminating the dual pipeline" is done: `build_catalog.py` is now the safe
reconciler and `sync_catalog.py` only merges CMS files into the generated
`catalog.json`, with validation in between. CMS track summaries, a lyrics
preview widget and a local hot-reload script were dropped as not worth the
complexity for a 5-album library.