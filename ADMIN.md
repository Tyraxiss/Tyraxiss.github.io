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

## Adding lyrics / songs after login

1. Open `/admin/` and sign in
2. Open **Albums** and click **one album** (each album is its own entry)
3. Expand a track
4. Add lyrics either by:
   - **Lyrics file:** upload a premade `.lrc` or `.vtt`
   - **Lyrics text:** paste plain / timed lyrics into the text box
5. **Publish** — CMS saves that album file; a GitHub Action rebuilds `data/catalog.json` for the public player
6. Wait a minute for Pages, then refresh the public site

Uploaded lyric files are stored under `Albums/lyrics/`. A lyrics file overrides the text box when both are set.

---

## Local player preview

```bash
npx --yes serve .
```

Then open the printed URL (not a raw `file://` path).

You can also drop files into `Albums/` and run:

```bash
python scripts/build_catalog.py
python scripts/sync_catalog.py sync
```

Keep individual MP3s under **100 MB**. Git **LFS does not work** with GitHub Pages.
