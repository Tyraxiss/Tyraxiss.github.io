# Manage your music library (Sveltia CMS)

The public player reads [`data/catalog.json`](data/catalog.json).  
Day-to-day editing is done in the browser at **`/admin/`**.

**Your live site:** https://tyraxiss.github.io/  
**Your live admin URL:** https://tyraxiss.github.io/admin/

---

## Recommended: sign in with a GitHub token (solo use)

This is the simplest option when only you edit the library. No Cloudflare or OAuth app required.

1. Open https://tyraxiss.github.io/admin/
2. Click **Sign In with Token** (wording may be similar)
3. Use the link in the dialog to create a GitHub **Personal Access Token**
   - Prefer a **fine-grained** token if offered
   - Resource access: only the **Tyraxiss/Tyraxiss.github.io** repo
   - Permissions: **Contents** read/write (and metadata read)
   - Or classic token with `repo` scope if that’s what the dialog links to
4. Generate the token, copy it, paste it into the CMS prompt
5. You’re in — open **Albums**, edit one album at a time, then **Publish**

The token is stored in your browser’s local storage. If login stops working later, create a new token and sign in again.

---

## Optional: one-click “Login with GitHub” (OAuth)

Only needed if you want a normal GitHub login button instead of pasting a token. Uses a free Cloudflare Worker as a tiny auth proxy.

### 1. Deploy the authenticator

1. Sign up / log in at [Cloudflare](https://dash.cloudflare.com/) (free)
2. Open [sveltia/sveltia-cms-auth](https://github.com/sveltia/sveltia-cms-auth)
3. Click **Deploy to Cloudflare Workers**
4. Copy your worker URL, e.g. `https://sveltia-cms-auth.YOUR_SUBDOMAIN.workers.dev`

### 2. Create a GitHub OAuth App

1. Open https://github.com/settings/applications/new
2. Fill in:
   - **Application name:** `Brian J. Smith CMS` (any name)
   - **Homepage URL:** `https://tyraxiss.github.io/`
   - **Authorization callback URL:** `https://YOUR-WORKER.workers.dev/callback`
3. Register, then **Generate a new client secret**
4. Copy the **Client ID** and **Client Secret**

### 3. Add secrets to the Worker

In Cloudflare → your `sveltia-cms-auth` worker → **Settings** → **Variables**:

| Variable | Value |
|---|---|
| `GITHUB_CLIENT_ID` | Client ID from step 2 |
| `GITHUB_CLIENT_SECRET` | Client Secret (encrypt/hide it) |
| `ALLOWED_DOMAINS` (optional) | `tyraxiss.github.io` |

Save / redeploy the worker.

### 4. Point the CMS at the worker

In [`admin/config.yml`](admin/config.yml):

```yaml
backend:
  name: github
  repo: Tyraxiss/Tyraxiss.github.io
  branch: main
  base_url: https://YOUR-WORKER.workers.dev
```

Commit and push, wait for Pages to update, then open `/admin/` and use **Login with GitHub**.

---

## Editing tracks and lyrics

1. Open `/admin/` and sign in, then open **Albums** and select the album you want to edit.
2. Expand the song. Use **Timed lyrics file (.lrc, enhanced .lrc, .vtt or .srt)** to select its existing file from `Albums/lyrics/`. The upload picker is filtered to lyric files; avoid uploading a duplicate when its file already exists.
3. For a new synced file, upload it from the same field. LRC lines must start with a timestamp such as `[00:12.34] words`; for word-by-word karaoke add word tags (`[00:12.34]<00:12.50>word <00:12.80>by word`) or WebVTT inline `<00:00:12.500>` stamps. Keep **Lyrics text (fallback)** empty while a timed file is attached.
4. For unsynchronized lyrics, leave the file field empty and paste plain lyrics into **Lyrics text (fallback)**.
5. Click **Publish**. A GitHub Action rebuilds `data/catalog.json`; wait for GitHub Pages to update.
6. Open [`/admin/lyrics-check.html`](https://tyraxiss.github.io/admin/lyrics-check.html) and run **Check linked lyrics**. The checker fetches the published catalog and every linked file and reports broken paths, inaccessible assets or missing timestamps with links to each file.

The check runs against the **published live files**, not unsaved drafts. If a path fails, return to the album entry, choose the matching existing lyrics asset, publish, and wait for Pages again. The public player prefers `lyricsFile` over the fallback text.

Uploaded lyric files are stored under `Albums/lyrics/`. For a new song, add the audio/track and set its matching `lyricsFile` before publishing; uploading a lyric alone does not attach it to a track.

---

## Local player preview

```bash
npx --yes serve .        # or: node tests/serve.cjs 8765
```

Then open the printed URL (not a raw `file://` path).

`tests/serve.cjs` answers HTTP Range requests (206) the way GitHub Pages does,
so seeking works while testing locally. `python -m http.server` does not, and
with it every seek silently snaps back to the start of the track.

You can also drop album folders into `Albums/` (not `Albums/lyrics/`) and rebuild:

```bash
# Scan disk folders, overlay real durations/cover art onto the album JSONs,
# then rebuild catalog.json. Safe: it never overwrites lyrics or lyric files.
python scripts/build_catalog.py

# Preview what would change without writing anything
python scripts/build_catalog.py --dry-run
```

If you only edited `data/albums/*.json` by hand or in the CMS, just merge:

```bash
python scripts/sync_catalog.py sync
```

### Supported lyric formats

| Format | Timing | Karaoke |
|---|---|---|
| LRC `[00:12.34] words` | line-by-line | line highlight |
| Enhanced LRC `[00:12.34]<00:12.50>word` | line + word | word-by-word |
| WebVTT cues (optional inline `<00:00:12.500>` stamps) | line + word | line or word-by-word |
| SRT (`00:00:12,500 --> ...`) | line-by-line | line highlight |
| Plain text | none | static list |

All five are parsed by `js/lyrics.js`, which the public player and the library
tools page share, so a file that previews cleanly behaves identically live.

### Adding a lyric file (three ways)

1. **In the browser (normal path):** open `admin/lyrics-check.html`, drop the
   file on **Test a lyrics file before publishing** to confirm it parses, then
   open the album editor, pick it in **Timed lyrics file** and publish.
2. **From the command line:**

   ```bash
   python scripts/add_lyrics.py the-last-of-me-02 "~/Downloads/song.lrc"
   ```

   It copies the file into `Albums/lyrics/`, links it on that track, rebuilds
   `data/catalog.json` and validates. Use `--name other.lrc` to control the
   destination filename, `--dry-run` to preview. Titles work too when they are
   unique (`python scripts/add_lyrics.py "Blue-Eyed Angel" file.lrc`).
3. **Upload the file yourself** into `Albums/lyrics/` and link it in the album
   editor (the CMS file picker lists that folder).

### Checking your work

```bash
# Fails loudly on missing audio, missing cover art, duplicate track ids,
# wrong durations and broken lyricsFile paths. Exits non-zero on problems.
python scripts/validate_catalog.py

# Make warnings (e.g. tiny cover art) fail too
python scripts/validate_catalog.py --strict
```

The same validation runs automatically in CI on every push, so a broken
catalog can never reach the live site.

### Tests

```bash
python tests/test_catalog.py    # pipeline helpers + shipped catalog invariants
python tests/test_validate.py   # proves the validator catches real breakage
node  tests/app-logic.test.js   # lyric parsing, shuffle, search, URL encoding
```

Keep individual MP3s under **100 MB**. Git **LFS does not work** with GitHub Pages.

### About repository size

Audio is committed straight into git (LFS is not an option on Pages), so the
repo grows with every track. It currently holds roughly 500 MB of audio, which
is fine — GitHub only *warns* above 1 GB and hard-blocks at 5 GB.

If you ever approach that warning, the options in order of preference are:
lower the bitrate of new uploads, move audio to external hosting and point
`src` at CDN URLs, or start a fresh repo without history. Re-encoding the
existing files in place is the least attractive option — it is lossy-to-lossy,
so it permanently degrades the masters for a modest saving.

### Adding songs

Drop the audio file into the album folder and run `python scripts/build_catalog.py`.
It adds the track with the real duration read from the file, assigns it a stable
id, and keeps every existing track's lyrics intact. Re-running it is always safe.
It exits non-zero if it had to drop an album folder, audio file or cover, so a
broken state can never be published silently (CI relies on that).
