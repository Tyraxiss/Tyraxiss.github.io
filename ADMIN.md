# Manage your music library (Sveltia CMS)

The public player reads [`data/catalog.json`](data/catalog.json).  
Day-to-day editing is done in the browser at **`/admin/`** — no hand-editing of JSON required once auth is set up.

## Quick local preview (player)

Because the site loads JSON with `fetch`, open it through a static server (not as a raw `file://` page):

```bash
# from the project root
npx --yes serve .
```

Then visit the printed URL (often `http://localhost:3000`).

## Enable GitHub Pages

1. Push this repo to GitHub.
2. **Settings → Pages → Build and deployment**
3. Source: **Deploy from a branch**
4. Branch: `main` / folder: `/ (root)`
5. Save. Site URL will be `https://<user>.github.io/<repo>/`

The empty [`.nojekyll`](.nojekyll) file tells Pages not to process the site with Jekyll.

## One-time CMS login setup

Sveltia CMS saves by committing to your GitHub repo. GitHub OAuth needs a tiny auth proxy (client secret stays off the public site).

### 1. Put your repo name in the CMS config

Edit [`admin/config.yml`](admin/config.yml):

```yaml
backend:
  name: github
  repo: YOUR_GITHUB_USERNAME/MP3-Website   # ← change this
  branch: main
```

### 2. Deploy the free Sveltia authenticator

1. Open [sveltia/sveltia-cms-auth](https://github.com/sveltia/sveltia-cms-auth)
2. Use **Deploy to Cloudflare Workers**
3. Note your worker URL, e.g. `https://sveltia-cms-auth.YOUR_SUBDOMAIN.workers.dev`

### 3. Create a GitHub OAuth App

1. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**
2. **Homepage URL:** your Pages URL, e.g. `https://YOUR_USER.github.io/MP3-Website/`
3. **Authorization callback URL:** `https://YOUR-WORKER.workers.dev/callback`
4. Copy the **Client ID** and generate a **Client Secret**
5. In the Cloudflare Worker settings/secrets for the authenticator, set those values (follow the auth repo README)

### 4. Point the CMS at the worker

In [`admin/config.yml`](admin/config.yml), uncomment and set:

```yaml
backend:
  base_url: https://YOUR-WORKER.workers.dev
```

Commit and push. Open:

`https://YOUR_USER.github.io/MP3-Website/admin/`

Log in with GitHub, then edit albums/tracks, upload covers & MP3s, and publish.

## Adding or removing songs

1. Open `/admin/`
2. Open **Music Catalog → Albums & Tracks**
3. Add/remove an album or track in the forms
4. Upload cover (`cover` field) and audio (`src` field)
5. Publish — CMS commits `data/catalog.json` and media under `Albums/`
6. Refresh the public site after Pages finishes updating

You can also drop new album folders into `Albums/` and regenerate the catalog locally:

```bash
python scripts/build_catalog.py
```

Keep individual MP3s under **100 MB** (GitHub hard limit). Git **LFS does not work** with GitHub Pages. The published site should stay near **1 GB** total.

## Optional: local CMS without OAuth

`local_backend: true` is enabled in `config.yml`. With the [Sveltia/Decap local proxy](https://github.com/decaporg/decap-server) running against this repo, you can test the admin UI on your machine before OAuth is ready. For day-to-day use on Pages, complete the OAuth steps above.
