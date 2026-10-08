import { normalizeLyrics, parseLyricsFile } from "./lyrics.js";

const CATALOG_URL = "./data/catalog.json";
const THEME_KEY = "bs-theme";
const KARAOKE_KEY = "bs-karaoke";
const VOLUME_KEY = "bs-volume";
const LAST_TRACK_KEY = "bs-last-track";
const POSITION_KEY = "bs-position";

// Resume within this many seconds of the end means "finished", don't resume.
const RESUME_TOLERANCE = 15;

const DEFAULT_VOLUME = 0.85;

const state = {
  albums: [],
  view: "home",
  albumId: null,
  current: null, // { albumId, trackIndex }
  shuffle: false,
  repeat: "off", // off | all | one
  seeking: false,
  playToken: 0,
  activeLyricIndex: -1,
  karaokeEnabled: true,
  lyricsAreTimed: false,
  queue: [], // [{ albumId, trackIndex }] consumed before normal next logic
  shufflePlayed: [], // indices already played, so shuffle never repeats itself
  query: "", // album/track search text
};

/* ---------------------------------------------------------------- storage */

function readNumber(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function writeValue(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // ignore storage failures (private mode, quota, etc.)
  }
}

function removeValue(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function trackKey(albumId, trackIndex) {
  return `${albumId}::${trackIndex}`;
}

function saveVolume() {
  writeValue(VOLUME_KEY, audio.volume.toFixed(2));
}

function restoreVolume() {
  const saved = readNumber(VOLUME_KEY, DEFAULT_VOLUME);
  const volume = Math.min(1, Math.max(0, saved));
  audio.volume = volume;
  if (els.volume) els.volume.value = String(volume);
  return volume;
}

function savePlaybackPosition() {
  const current = getCurrentTrack();
  if (!current || !Number.isFinite(audio.currentTime)) return;
  writeValue(LAST_TRACK_KEY, trackKey(current.album.id, current.trackIndex));
  writeValue(POSITION_KEY, Math.floor(audio.currentTime));
}

/** Track saved on the previous visit, if it still exists in the catalog. */
function loadSavedPlayback() {
  const savedKey = (() => {
    try {
      return localStorage.getItem(LAST_TRACK_KEY);
    } catch {
      return null;
    }
  })();
  if (!savedKey) return null;

  const [albumId, indexRaw] = savedKey.split("::");
  const trackIndex = Number(indexRaw);
  const album = getAlbum(albumId);
  if (!album || !Number.isInteger(trackIndex) || !album.tracks?.[trackIndex]) {
    return null;
  }

  const position = readNumber(POSITION_KEY, 0);
  const duration = album.tracks[trackIndex].duration;
  // Skip resume when the listener was basically at the end of the track.
  if (!position || position < 5) return null;
  if (Number.isFinite(duration) && position > duration - RESUME_TOLERANCE) return null;
  return { albumId, trackIndex, position };
}

/* ------------------------------------------------------------------ toast */

let toastTimer = 0;

function showToast(message, { duration = 4200 } = {}) {
  let node = document.getElementById("toast");
  if (!node) {
    node = document.createElement("div");
    node.id = "toast";
    node.className = "toast";
    node.setAttribute("role", "status");
    node.setAttribute("aria-live", "polite");
    document.body.appendChild(node);
  }

  node.textContent = message;
  node.classList.add("is-visible");

  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    node.classList.remove("is-visible");
  }, duration);
}

function getTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark"
    ? "dark"
    : "light";
}

function setTheme(theme) {
  const next = theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // ignore storage failures
  }
  const btn = document.getElementById("btn-theme");
  if (btn) {
    btn.title = next === "dark" ? "Switch to light mode" : "Switch to dark mode";
    btn.setAttribute(
      "aria-label",
      next === "dark" ? "Switch to light mode" : "Switch to dark mode"
    );
  }
}

function toggleTheme() {
  setTheme(getTheme() === "dark" ? "light" : "dark");
  refreshAtmosphere();
}

const paletteCache = new Map();
let atmosphereToken = 0;
let activeCoverKey = null;

const DEFAULT_ATMOSPHERE = {
  light: {
    glowA: [176, 206, 214],
    glowB: [214, 198, 184],
    wash1: [232, 238, 242],
    wash2: [243, 241, 236],
    wash3: [228, 235, 232],
  },
  dark: {
    glowA: [40, 78, 88],
    glowB: [70, 55, 48],
    wash1: [16, 22, 28],
    wash2: [20, 26, 32],
    wash3: [14, 21, 24],
  },
};

function mixRgb(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function rgbKey(rgb) {
  return rgb.join(", ");
}

function setAtmosphereVars(vars) {
  const root = document.documentElement;
  root.style.setProperty("--glow-a", rgbKey(vars.glowA));
  root.style.setProperty("--glow-b", rgbKey(vars.glowB));
  root.style.setProperty("--wash-1", rgbKey(vars.wash1));
  root.style.setProperty("--wash-2", rgbKey(vars.wash2));
  root.style.setProperty("--wash-3", rgbKey(vars.wash3));
  root.style.setProperty(
    "--body-bg",
    `rgb(${rgbKey(mixRgb(vars.wash1, vars.wash3, 0.35))})`
  );
}

function resetAtmosphere() {
  activeCoverKey = null;
  document.documentElement.style.removeProperty("--glow-a");
  document.documentElement.style.removeProperty("--glow-b");
  document.documentElement.style.removeProperty("--wash-1");
  document.documentElement.style.removeProperty("--wash-2");
  document.documentElement.style.removeProperty("--wash-3");
  document.documentElement.style.removeProperty("--body-bg");
}

function loadCoverImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load cover: ${url}`));
    img.src = url;
  });
}

function extractPaletteFromImage(img) {
  const size = 36;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(img, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);
  const buckets = new Map();

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a < 200) continue;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lum = (r + g + b) / 3;
    if (lum < 16 || lum > 245) continue;

    const sat = max === 0 ? 0 : (max - min) / max;
    const qr = r >> 4;
    const qg = g >> 4;
    const qb = b >> 4;
    const key = (qr << 8) | (qg << 4) | qb;
    const weight = 1 + sat * 3;
    const prev = buckets.get(key);
    if (prev) {
      prev.w += weight;
      prev.r += r * weight;
      prev.g += g * weight;
      prev.b += b * weight;
    } else {
      buckets.set(key, { w: weight, r: r * weight, g: g * weight, b: b * weight });
    }
  }

  const ranked = [...buckets.values()]
    .map((bucket) => ({
      w: bucket.w,
      rgb: [
        Math.round(bucket.r / bucket.w),
        Math.round(bucket.g / bucket.w),
        Math.round(bucket.b / bucket.w),
      ],
    }))
    .sort((a, b) => b.w - a.w);

  if (!ranked.length) return null;

  const primary = ranked[0].rgb;
  let secondary = ranked.find((entry) => {
    const dr = entry.rgb[0] - primary[0];
    const dg = entry.rgb[1] - primary[1];
    const db = entry.rgb[2] - primary[2];
    return dr * dr + dg * dg + db * db > 2800;
  })?.rgb;

  if (!secondary) {
    secondary = mixRgb(primary, [180, 170, 160], 0.45);
  }

  return { primary, secondary };
}

async function getCoverPalette(coverPath) {
  const url = assetUrl(coverPath);
  if (paletteCache.has(url)) return paletteCache.get(url);

  try {
    const img = await loadCoverImage(url);
    const palette = extractPaletteFromImage(img);
    if (palette) paletteCache.set(url, palette);
    return palette;
  } catch {
    return null;
  }
}

function paletteToAtmosphere(palette) {
  const theme = getTheme();
  const defaults = DEFAULT_ATMOSPHERE[theme];
  if (!palette) return defaults;

  const { primary, secondary } = palette;

  if (theme === "light") {
    const paper = [243, 241, 236];
    return {
      glowA: mixRgb(primary, [210, 225, 230], 0.28),
      glowB: mixRgb(secondary, [230, 215, 200], 0.32),
      wash1: mixRgb(primary, paper, 0.78),
      wash2: mixRgb(mixRgb(primary, secondary, 0.5), paper, 0.84),
      wash3: mixRgb(secondary, paper, 0.8),
    };
  }

  const deep = [12, 16, 20];
  return {
    glowA: mixRgb(primary, [50, 70, 80], 0.35),
    glowB: mixRgb(secondary, [70, 55, 50], 0.4),
    wash1: mixRgb(primary, deep, 0.82),
    wash2: mixRgb(mixRgb(primary, secondary, 0.45), deep, 0.86),
    wash3: mixRgb(secondary, deep, 0.84),
  };
}

function flashAtmosphere() {
  const node = document.querySelector(".atmosphere");
  if (!node) return;
  node.classList.add("is-shifting");
  window.setTimeout(() => node.classList.remove("is-shifting"), 280);
}

async function applyCoverAtmosphere(coverPath, { force = false } = {}) {
  const token = ++atmosphereToken;
  const key = coverPath || "";

  if (!coverPath) {
    flashAtmosphere();
    resetAtmosphere();
    return;
  }

  if (!force && key === activeCoverKey) return;

  const palette = await getCoverPalette(coverPath);
  if (token !== atmosphereToken) return;

  activeCoverKey = key;
  flashAtmosphere();
  setAtmosphereVars(paletteToAtmosphere(palette));
}

function refreshAtmosphere() {
  const album =
    (state.albumId && getAlbum(state.albumId)) ||
    (state.current && getAlbum(state.current.albumId)) ||
    null;

  if (album?.cover) applyCoverAtmosphere(album.cover, { force: true });
  else applyCoverAtmosphere(null);
}

const audio = new Audio();
audio.preload = "metadata";
audio.volume = DEFAULT_VOLUME;

const els = {
  viewRoot: document.getElementById("view-root"),
  albumNav: document.getElementById("album-nav"),
  navHome: document.getElementById("nav-home"),
  mainView: document.getElementById("main-view"),
  npArt: document.getElementById("np-art"),
  npArtFallback: document.getElementById("np-art-fallback"),
  npTitle: document.getElementById("np-title"),
  npArtist: document.getElementById("np-artist"),
  btnPlay: document.getElementById("btn-play"),
  iconPlay: document.getElementById("icon-play"),
  iconPause: document.getElementById("icon-pause"),
  btnPrev: document.getElementById("btn-prev"),
  btnNext: document.getElementById("btn-next"),
  btnShuffle: document.getElementById("btn-shuffle"),
  btnRepeat: document.getElementById("btn-repeat"),
  btnLyrics: document.getElementById("btn-lyrics"),
  seek: document.getElementById("seek"),
  volume: document.getElementById("volume"),
  timeElapsed: document.getElementById("time-elapsed"),
  timeDuration: document.getElementById("time-duration"),
  lyricsPanel: document.getElementById("lyrics-panel"),
  lyricsHeading: document.getElementById("lyrics-heading"),
  lyricsSub: document.getElementById("lyrics-sub"),
  lyricsLines: document.getElementById("lyrics-lines"),
  btnKaraoke: document.getElementById("btn-karaoke"),
};

function loadKaraokePreference() {
  try {
    const saved = localStorage.getItem(KARAOKE_KEY);
    if (saved === "off") state.karaokeEnabled = false;
    else if (saved === "on") state.karaokeEnabled = true;
  } catch {
    // keep default
  }
}

function saveKaraokePreference() {
  try {
    localStorage.setItem(KARAOKE_KEY, state.karaokeEnabled ? "on" : "off");
  } catch {
    // ignore
  }
}

function syncKaraokeButton() {
  if (!els.btnKaraoke) return;
  const show = state.lyricsAreTimed;
  els.btnKaraoke.hidden = !show;
  els.btnKaraoke.setAttribute("aria-pressed", String(state.karaokeEnabled));
  els.btnKaraoke.title = state.karaokeEnabled
    ? "Turn off karaoke style"
    : "Turn on karaoke style";
}

function applyKaraokeMode() {
  const on = state.lyricsAreTimed && state.karaokeEnabled;
  els.lyricsPanel.classList.toggle("is-karaoke", on);
  if (els.lyricsHeading) {
    els.lyricsHeading.textContent = on ? "Karaoke" : "Lyrics";
  }
  syncKaraokeButton();
}

function toggleKaraokeMode() {
  if (!state.lyricsAreTimed) return;
  state.karaokeEnabled = !state.karaokeEnabled;
  saveKaraokePreference();
  applyKaraokeMode();
  state.activeLyricIndex = -1;
  updateLyricsHighlight(audio.currentTime || 0);
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function getAlbum(albumId) {
  return state.albums.find((a) => a.id === albumId) ?? null;
}

function getCurrentTrack() {
  if (!state.current) return null;
  const album = getAlbum(state.current.albumId);
  if (!album) return null;
  const tracks = Array.isArray(album.tracks) ? album.tracks : [];
  const track = tracks[state.current.trackIndex];
  if (!track) return null;
  return { album, track, trackIndex: state.current.trackIndex };
}

function currentTrackKey() {
  if (!state.current) return "";
  const current = getCurrentTrack();
  if (!current) return "";
  return `${current.album.id}::${current.trackIndex}::${current.track.id || current.track.src || ""}`;
}

function setHash(view, albumId) {
  if (view === "home") {
    history.replaceState(null, "", "#/");
  } else if (view === "album" && albumId) {
    history.replaceState(null, "", `#/album/${encodeURIComponent(albumId)}`);
  }
}

function parseHash() {
  const raw = location.hash.replace(/^#/, "") || "/";
  const parts = raw.split("/").filter(Boolean);
  if (parts[0] === "album" && parts[1]) {
    try {
      return { view: "album", albumId: decodeURIComponent(parts[1]) };
    } catch {
      return { view: "home", albumId: null };
    }
  }
  return { view: "home", albumId: null };
}

const lyricsCache = new Map();

async function resolveTrackLyrics(track, albumId = "", trackIndex = -1) {
  if (!track) return [];

  const cacheKey = `${albumId}::${trackIndex}::${track.id || track.src || ""}::${track.lyricsFile || ""}::${typeof track.lyrics === "string" ? track.lyrics.length : "arr"}`;
  if (lyricsCache.has(cacheKey)) return lyricsCache.get(cacheKey);

  let lines = [];
  let fileError = null;

  if (track.lyricsFile) {
    try {
      const url = assetUrl(track.lyricsFile);
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) {
        fileError = `Could not load lyrics file (${res.status})`;
      } else {
        const text = await res.text();
        // LRC, enhanced LRC, WebVTT and SRT - picked by extension or sniffed.
        lines = parseLyricsFile(text, track.lyricsFile).lines;
        if (!lines.length) {
          fileError = "Lyrics file loaded, but no lines were found";
        }
      }
    } catch (error) {
      fileError = "Could not load lyrics file";
      console.warn(fileError, track.lyricsFile, error);
    }
  }

  if (!lines.length) lines = normalizeLyrics(track.lyrics);

  // Only cache successful lyric loads (avoid sticky empty cache after a failed fetch).
  if (lines.length) lyricsCache.set(cacheKey, lines);

  if (!lines.length && fileError) {
    return [{ time: null, text: fileError, words: null }];
  }
  return lines;
}

function renderSidebar() {
  els.albumNav.innerHTML = state.albums
    .map(
      (album) => `
      <button
        type="button"
        class="album-nav-btn${state.view === "album" && state.albumId === album.id ? " is-active" : ""}"
        data-album-id="${escapeAttr(album.id)}"
      >
        ${escapeHtml(album.title)}
      </button>`
    )
    .join("");
}

function matchesQuery(album) {
  const query = state.query.trim().toLowerCase();
  if (!query) return true;
  if (album.title?.toLowerCase().includes(query)) return true;
  if (album.artist?.toLowerCase().includes(query)) return true;
  if (String(album.year ?? "").includes(query)) return true;
  return (album.tracks || []).some((track) =>
    track.title?.toLowerCase().includes(query)
  );
}

function renderHome() {
  if (!state.albums.length) {
    els.viewRoot.innerHTML = `
      <div class="home-intro">
        <h1>Brian J. Smith</h1>
        <p>Your library is empty. Open <a href="./admin/">Library</a> to add albums, then refresh.</p>
      </div>
    `;
    return;
  }

  const visible = state.albums.filter(matchesQuery);
  const query = state.query.trim();

  els.viewRoot.innerHTML = `
    <div class="home-intro">
      <h1>Brian J. Smith</h1>
      <p>A quiet place for the albums — open one and press play.</p>
    </div>
    ${
      query
        ? `<p class="search-note">${
            visible.length
              ? `${visible.length} album${visible.length === 1 ? "" : "s"} matching “${escapeHtml(query)}”`
              : `No albums match “${escapeHtml(query)}”`
          }</p>`
        : ""
    }
    <div class="album-grid">
      ${
        visible.length
          ? visible
              .map(
                (album) => `
        <button type="button" class="album-card" data-open-album="${escapeAttr(album.id)}">
          <div class="album-card-art-wrap album-frame">
            <img src="${escapeAttr(assetUrl(album.cover))}" alt="" loading="lazy" />
          </div>
          <p class="album-card-title">${escapeHtml(album.title)}</p>
          <p class="album-card-meta">${(album.tracks || []).length} tracks${
                  album.year ? ` · ${escapeHtml(String(album.year))}` : ""
                }</p>
        </button>`
              )
              .join("")
          : `<p class="state-msg">Nothing found. Try a different search.</p>`
      }
    </div>
  `;
}

/** Pulsing placeholder grid shown while catalog.json is still loading. */
function renderSkeleton() {
  els.viewRoot.innerHTML = `
    <div class="home-intro">
      <h1>Brian J. Smith</h1>
      <p class="skeleton-line"></p>
    </div>
    <div class="album-grid">
      ${Array.from({ length: 5 })
        .map(
          () => `
        <div class="album-card skeleton-card" aria-hidden="true">
          <div class="album-card-art-wrap album-frame skeleton-art"></div>
          <p class="skeleton-line"></p>
          <p class="skeleton-line skeleton-line-short"></p>
        </div>`
        )
        .join("")}
    </div>
  `;
}

function renderAlbum(albumId) {
  const album = getAlbum(albumId);
  if (!album) {
    els.viewRoot.innerHTML = `
      <h1 class="view-title">Album not found</h1>
      <p class="view-sub">That album is missing from the catalog.</p>
    `;
    return;
  }

  const current = getCurrentTrack();
  const yearBit = album.year ? ` · ${escapeHtml(String(album.year))}` : "";
  const tracks = Array.isArray(album.tracks) ? album.tracks : [];

  els.viewRoot.innerHTML = `
    <button type="button" class="back-home" data-go-home>All albums</button>
    <div class="album-hero">
      <figure class="album-frame album-hero-frame">
        <img class="album-hero-art" src="${escapeAttr(assetUrl(album.cover))}" alt="" />
      </figure>
      <div>
        <p class="album-kicker">Album</p>
        <h1>${escapeHtml(album.title)}</h1>
        <p class="album-hero-meta">
          ${escapeHtml(album.artist)}${yearBit} · ${tracks.length} tracks
        </p>
        <div class="album-hero-actions">
          <button type="button" class="ctrl ctrl-text hero-action" data-play-album-all>
            ▶ Play All
          </button>
          <button type="button" class="ctrl ctrl-text hero-action" data-shuffle-album-all>
            Shuffle
          </button>
        </div>
      </div>
    </div>
    <div class="track-list" role="list">
      ${tracks
        .map((track, index) => {
          const isCurrent =
            current &&
            current.album.id === album.id &&
            current.trackIndex === index;
          return `
          <div class="track-row-wrap${isCurrent ? " is-current" : ""}" role="listitem">
            <button
              type="button"
              class="track-row"
              data-play-track="${index}"
            >
              <span class="track-num">${String(index + 1).padStart(2, "0")}</span>
              <span class="track-title">${escapeHtml(track.title)}</span>
              <span class="track-dur">${formatTime(track.duration)}</span>
            </button>
            <div class="track-tools">
              <button
                type="button"
                class="track-tool"
                data-queue-track="${index}"
                title="Play next"
                aria-label="Play ${escapeAttr(track.title)} next"
              >＋</button>
              <a
                class="track-tool"
                href="${escapeAttr(assetUrl(track.src))}"
                download
                title="Download"
                aria-label="Download ${escapeAttr(track.title)}"
              >↓</a>
            </div>
          </div>`;
        })
        .join("")}
    </div>
  `;
}

function renderView() {
  renderSidebar();
  if (state.view === "album") {
    renderAlbum(state.albumId);
  } else {
    renderHome();
  }
  // re-trigger enter animation
  els.viewRoot.style.animation = "none";
  // force reflow
  void els.viewRoot.offsetWidth;
  els.viewRoot.style.animation = "";
}

function showHome() {
  state.view = "home";
  state.albumId = null;
  setHash("home");
  renderView();
  els.mainView.focus({ preventScroll: true });

  const playingAlbum = state.current ? getAlbum(state.current.albumId) : null;
  if (playingAlbum?.cover) applyCoverAtmosphere(playingAlbum.cover);
  else applyCoverAtmosphere(null);
}

function showAlbum(albumId) {
  const album = getAlbum(albumId);
  if (!album) {
    showHome();
    return;
  }
  state.view = "album";
  state.albumId = albumId;
  setHash("album", albumId);
  renderView();
  els.mainView.focus({ preventScroll: true });
  applyCoverAtmosphere(album.cover);
}

function updateNowPlaying() {
  const current = getCurrentTrack();
  if (!current) {
    els.npTitle.textContent = "Nothing playing";
    els.npArtist.textContent = "Pick a track to start";
    els.npArt.hidden = true;
    els.npArtFallback.hidden = false;
    return;
  }

  els.npTitle.textContent = current.track.title;
  els.npArtist.textContent = `${current.album.artist} · ${current.album.title}`;
  els.npArt.src = assetUrl(current.album.cover);
  els.npArt.hidden = false;
  els.npArtFallback.hidden = true;
}

function updatePlayButton() {
  const playing = !audio.paused && !audio.ended;
  els.iconPlay.hidden = playing;
  els.iconPause.hidden = !playing;
  els.btnPlay.title = playing ? "Pause" : "Play";
}

function updateProgress() {
  if (state.seeking) return;
  const duration = audio.duration || 0;
  const current = audio.currentTime || 0;
  els.timeElapsed.textContent = formatTime(current);
  els.timeDuration.textContent = formatTime(duration);
  const max = Number(els.seek.max) || 1000;
  els.seek.value = duration ? String(Math.round((current / duration) * max)) : "0";
  updateLyricsHighlight(current);
}

/** Add a track to the cross-album "play next" queue. */
function enqueueTrack(albumId, trackIndex) {
  if (!getAlbum(albumId)?.tracks?.[trackIndex]) return;
  state.queue.push({ albumId, trackIndex });
}

async function playTrack(albumId, trackIndex, { autoplay = true } = {}) {
  const album = getAlbum(albumId);
  const tracks = Array.isArray(album?.tracks) ? album.tracks : [];
  if (!album || !tracks[trackIndex]) return;

  const token = ++state.playToken;
  state.current = { albumId, trackIndex };
  state.activeLyricIndex = -1;
  const track = tracks[trackIndex];
  audio.src = assetUrl(track.src);
  updateNowPlaying();
  updateDocumentTitle();
  renderView();
  if (!els.lyricsPanel.hidden) renderLyrics();
  applyCoverAtmosphere(album.cover);

  if (autoplay) {
    try {
      await audio.play();
    } catch {
      // Autoplay may be blocked until a user gesture; controls still work.
    }
  }
  if (token !== state.playToken) return;
  updatePlayButton();
}

function updateDocumentTitle() {
  const current = getCurrentTrack();
  document.title = current
    ? `${current.track.title} · ${current.album.title} · Brian J. Smith`
    : "Brian J. Smith";
}

/** Next shuffled index for an album, avoiding recently played tracks. */
function pickShuffleIndex(tracks, fromIndex) {
  if (tracks.length <= 1) return 0;

  // Forget everything once the whole album has been played in this cycle.
  if (state.shufflePlayed.length >= tracks.length) state.shufflePlayed = [];

  const candidates = tracks
    .map((_, index) => index)
    .filter((index) => index !== fromIndex && !state.shufflePlayed.includes(index));

  const pool = candidates.length ? candidates : tracks.map((_, i) => i).filter((i) => i !== fromIndex);
  const next = pool[Math.floor(Math.random() * pool.length)];
  state.shufflePlayed.push(next);
  return next;
}

function nextIndex(album, fromIndex, { force = false } = {}) {
  const tracks = Array.isArray(album.tracks) ? album.tracks : [];
  if (!tracks.length) return null;
  if (state.repeat === "one" && !force) return fromIndex;

  if (state.shuffle) {
    if (tracks.length <= 1) {
      return state.repeat === "off" ? null : fromIndex;
    }
    return pickShuffleIndex(tracks, fromIndex);
  }

  const next = fromIndex + 1;
  if (next < tracks.length) return next;
  if (state.repeat === "all") return 0;
  return null;
}

function prevIndex(album, fromIndex) {
  const tracks = Array.isArray(album.tracks) ? album.tracks : [];
  if (state.shuffle) {
    // Step back through what shuffle already played.
    if (state.shufflePlayed.length > 1) {
      state.shufflePlayed.pop();
      return state.shufflePlayed[state.shufflePlayed.length - 1];
    }
    return nextIndex(album, fromIndex, { force: true });
  }
  const prev = fromIndex - 1;
  if (prev >= 0) return prev;
  if (state.repeat === "all") return Math.max(tracks.length - 1, 0);
  return 0;
}

async function playNext({ force = false } = {}) {
  const current = getCurrentTrack();
  if (!current) return;

  // Queued tracks win over normal album order.
  if (state.queue.length && !force) {
    const next = state.queue.shift();
    await playTrack(next.albumId, next.trackIndex);
    return;
  }

  const next = nextIndex(current.album, current.trackIndex, { force });
  if (next === null) {
    audio.pause();
    removeValue(POSITION_KEY);
    updatePlayButton();
    return;
  }
  await playTrack(current.album.id, next);
}

async function playPrev() {
  const current = getCurrentTrack();
  if (!current) return;
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }
  const prev = prevIndex(current.album, current.trackIndex);
  await playTrack(current.album.id, prev);
}

function toggleShuffle() {
  state.shuffle = !state.shuffle;
  state.shufflePlayed = [];
  els.btnShuffle.setAttribute("aria-pressed", String(state.shuffle));
  showToast(state.shuffle ? "Shuffle on" : "Shuffle off", { duration: 1600 });
}

function cycleRepeat() {
  state.repeat =
    state.repeat === "off" ? "all" : state.repeat === "all" ? "one" : "off";
  els.btnRepeat.setAttribute("aria-pressed", String(state.repeat !== "off"));
  els.btnRepeat.title =
    state.repeat === "off"
      ? "Repeat"
      : state.repeat === "all"
        ? "Repeat all"
        : "Repeat one";
}

async function renderLyrics() {
  const current = getCurrentTrack();
  if (!current) {
    state.lyricsAreTimed = false;
    applyKaraokeMode();
    els.lyricsSub.textContent = "";
    els.lyricsLines.innerHTML = `<p class="lyric-empty">Nothing playing</p>`;
    return;
  }

  const requestKey = currentTrackKey();
  els.lyricsSub.textContent = `${current.track.title} · ${current.album.title}`;
  els.lyricsLines.innerHTML = `<p class="lyric-empty">Loading lyrics…</p>`;

  const lines = await resolveTrackLyrics(
    current.track,
    current.album.id,
    current.trackIndex
  );
  if (currentTrackKey() !== requestKey) return;

  if (!lines.length) {
    state.lyricsAreTimed = false;
    applyKaraokeMode();
    const hint = current.track.lyricsFile
      ? `No lyrics found for this track (file: ${current.track.lyricsFile}).`
      : "No lyrics for this track yet.";
    els.lyricsLines.innerHTML = `<p class="lyric-empty">${escapeHtml(hint)}</p>`;
    return;
  }

  state.lyricsAreTimed = lines.some(
    (line) => typeof line.time === "number" && Number.isFinite(line.time)
  );
  applyKaraokeMode();

  state.activeLyricIndex = -1;
  els.lyricsLines.innerHTML = lines
    .map((line, i) => {
      const hasWords = Array.isArray(line.words) && line.words.length > 0;
      const body = hasWords
        ? line.words
            .map(
              (word) =>
                `<span class="lyric-word" data-time="${Number(word.time)}">${escapeHtml(word.text)}</span>`
            )
            .join("")
        : escapeHtml(line.text);
      return `<p class="lyric-line${hasWords ? " has-words" : ""}" data-lyric-index="${i}" data-time="${line.time ?? ""}"><span class="lyric-text">${body}</span></p>`;
    })
    .join("");
  updateLyricsHighlight(audio.currentTime || 0);
}

function updateLyricsHighlight(currentTime) {
  if (els.lyricsPanel.hidden) return;
  const nodes = [...els.lyricsLines.querySelectorAll(".lyric-line")];
  if (!nodes.length) return;

  const times = nodes.map((node) => {
    const raw = node.getAttribute("data-time");
    return raw === "" || raw == null ? null : Number(raw);
  });

  const hasTimestamps = times.some((t) => typeof t === "number" && Number.isFinite(t));
  if (!hasTimestamps) {
    state.lyricsAreTimed = false;
    applyKaraokeMode();
    return;
  }

  let active = 0;
  for (let i = 0; i < times.length; i += 1) {
    const t = times[i];
    if (typeof t === "number" && t <= currentTime) active = i;
  }

  const changed = active !== state.activeLyricIndex;
  const previous = state.activeLyricIndex;
  state.activeLyricIndex = active;
  const karaokeOn = state.karaokeEnabled;

  // Line-level progress: drives the gradient on lines without word timings.
  const start = times[active] ?? currentTime;
  let end = times[active + 1];
  if (typeof end !== "number" || !Number.isFinite(end) || end <= start) {
    end = start + 4;
  }
  let progress = Math.min(1, Math.max(0, (currentTime - start) / (end - start)));

  // Word-level progress: drives per-word colouring for enhanced LRC / WebVTT.
  const activeNode = nodes[active];
  const wordNodes = activeNode ? [...activeNode.querySelectorAll(".lyric-word")] : [];
  if (wordNodes.length) {
    const wordTimes = wordNodes.map((node) => Number(node.getAttribute("data-time")));
    let activeWord = -1;
    for (let i = 0; i < wordNodes.length; i += 1) {
      if (Number.isFinite(wordTimes[i]) && wordTimes[i] <= currentTime) activeWord = i;
    }

    if (activeWord >= 0) {
      const wordStart = wordTimes[activeWord];
      const wordEnd = Number.isFinite(wordTimes[activeWord + 1])
        ? wordTimes[activeWord + 1]
        : wordStart + 1;
      const fraction =
        wordEnd > wordStart
          ? Math.min(1, Math.max(0, (currentTime - wordStart) / (wordEnd - wordStart)))
          : 1;
      progress = (activeWord + fraction) / wordNodes.length;
    } else {
      progress = 0;
    }

    wordNodes.forEach((node, i) => {
      node.classList.toggle("is-active", i === activeWord);
      node.classList.toggle("is-past", i < activeWord);
    });
  }

  // Drop word state left behind on the line we just scrolled away from.
  if (changed && previous >= 0 && previous !== active && nodes[previous]) {
    nodes[previous].querySelectorAll(".lyric-word").forEach((node) => {
      node.classList.remove("is-active", "is-past");
    });
  }

  const progressPct = `${(progress * 100).toFixed(1)}%`;

  nodes.forEach((node, i) => {
    node.classList.toggle("is-active", i === active);
    node.classList.toggle("is-past", karaokeOn && i < active);
    node.classList.toggle("is-upcoming", karaokeOn && i > active);
    if (karaokeOn && i === active) {
      node.style.setProperty("--lyric-progress", progressPct);
    } else {
      node.style.removeProperty("--lyric-progress");
    }
  });

  if (changed && nodes[active]) {
    nodes[active].scrollIntoView({
      block: karaokeOn ? "center" : "nearest",
      behavior: "smooth",
    });
  }
}

function openLyrics() {
  const app = document.getElementById("app");
  els.lyricsPanel.hidden = false;
  app?.classList.add("lyrics-open");
  els.btnLyrics.setAttribute("aria-pressed", "true");
  renderLyrics();
}

function closeLyrics() {
  const app = document.getElementById("app");
  els.lyricsPanel.hidden = true;
  els.lyricsPanel.classList.remove("is-karaoke");
  app?.classList.remove("lyrics-open");
  els.btnLyrics.setAttribute("aria-pressed", "false");
  state.activeLyricIndex = -1;
  if (els.lyricsHeading) els.lyricsHeading.textContent = "Lyrics";
  if (els.btnKaraoke) els.btnKaraoke.hidden = true;
}

function toggleLyrics() {
  if (els.lyricsPanel.hidden) openLyrics();
  else closeLyrics();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

/** Encode path segments so names with spaces (e.g. Albums/Broken Thoughts) load correctly. */
function assetUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;

  let normalized = String(path).replace(/\\/g, "/");
  // CMS / legacy prefixes → site-relative
  normalized = normalized.replace(/^(?:\.\/)?MP3-Website\//i, "");
  normalized = normalized.replace(/^\/MP3-Website\//i, "");
  normalized = normalized.replace(/^\.\//, "");
  normalized = normalized.replace(/^\//, "");

  return (
    "./" +
    normalized
      .split("/")
      .filter(Boolean)
      .map((part) => {
        try {
          part = decodeURIComponent(part);
        } catch {
          // keep raw segment
        }
        return encodeURIComponent(part);
      })
      .join("/")
  );
}

/** True when the focused element lives inside a region that scrolls itself. */
function insideScrollableRegion(node) {
  let el = node instanceof Element ? node : node?.parentElement;
  while (el) {
    const style = window.getComputedStyle(el);
    if (
      (style.overflowY === "auto" || style.overflowY === "scroll") &&
      el.scrollHeight > el.clientHeight + 1
    ) {
      return true;
    }
    el = el.parentElement;
  }
  return false;
}

function bindEvents() {
  els.navHome.addEventListener("click", (event) => {
    event.preventDefault();
    showHome();
  });

  const themeBtn = document.getElementById("btn-theme");
  if (themeBtn) {
    themeBtn.addEventListener("click", toggleTheme);
  }

  els.albumNav.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-album-id]");
    if (!btn) return;
    showAlbum(btn.getAttribute("data-album-id"));
  });

  els.viewRoot.addEventListener("click", async (event) => {
    if (event.target.closest("[data-go-home]")) {
      showHome();
      return;
    }

    const openAlbum = event.target.closest("[data-open-album]");
    if (openAlbum) {
      showAlbum(openAlbum.getAttribute("data-open-album"));
      return;
    }

    if (event.target.closest("[data-play-album-all]") && state.albumId) {
      state.shufflePlayed = [];
      await playTrack(state.albumId, 0);
      return;
    }

    if (event.target.closest("[data-shuffle-album-all]") && state.albumId) {
      const album = getAlbum(state.albumId);
      const total = album?.tracks?.length || 0;
      if (!total) return;
      if (!state.shuffle) {
        state.shuffle = true;
        els.btnShuffle.setAttribute("aria-pressed", "true");
      }
      state.shufflePlayed = [];
      await playTrack(state.albumId, pickShuffleIndex(album.tracks, -1));
      return;
    }

    const queued = event.target.closest("[data-queue-track]");
    if (queued && state.albumId) {
      const index = Number(queued.getAttribute("data-queue-track"));
      enqueueTrack(state.albumId, index);
      const album = getAlbum(state.albumId);
      showToast(`Queued: ${album?.tracks?.[index]?.title ?? "track"}`, {
        duration: 2200,
      });
      return;
    }

    const row = event.target.closest("[data-play-track]");
    if (row && state.albumId) {
      const index = Number(row.getAttribute("data-play-track"));
      await playTrack(state.albumId, index);
    }
  });

  els.btnPlay.addEventListener("click", async () => {
    if (!state.current) {
      const first = state.albums[0];
      if (first?.tracks?.[0]) await playTrack(first.id, 0);
      return;
    }
    try {
      if (audio.paused) await audio.play();
      else audio.pause();
    } catch {
      // Play may be blocked until a user gesture.
    }
    updatePlayButton();
  });

  els.btnNext.addEventListener("click", () => playNext({ force: true }));
  els.btnPrev.addEventListener("click", playPrev);
  els.btnShuffle.addEventListener("click", toggleShuffle);
  els.btnRepeat.addEventListener("click", cycleRepeat);
  els.btnLyrics.addEventListener("click", toggleLyrics);
  if (els.btnKaraoke) {
    els.btnKaraoke.addEventListener("click", toggleKaraokeMode);
  }

  els.lyricsPanel.addEventListener("click", (event) => {
    if (event.target.closest("[data-close-lyrics]")) closeLyrics();
  });

  document.addEventListener("keydown", (event) => {
    // Never hijack typing (search box, CMS fields, etc.).
    const target = event.target;
    const typing =
      target instanceof HTMLElement &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable);

    if (event.key === "Escape") {
      if (!els.lyricsPanel.hidden) closeLyrics();
      else if (typing) target.blur();
      return;
    }
    if (typing || event.metaKey || event.altKey) return;

    // Space must still activate a focused link or button natively.
    const onControl =
      target instanceof Element &&
      target.closest("a, button, summary, [role=button]") !== null;
    if (onControl && (event.key === " " || event.key === "Spacebar")) return;

    const current = getCurrentTrack();
    const hasTrack = Boolean(current);

    switch (event.key) {
      case " ":
      case "Spacebar":
        event.preventDefault();
        els.btnPlay.click();
        break;
      case "ArrowRight":
        event.preventDefault();
        if (event.ctrlKey) playNext({ force: true });
        else if (hasTrack) audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5);
        break;
      case "ArrowLeft":
        event.preventDefault();
        if (event.ctrlKey) playPrev();
        else if (hasTrack) audio.currentTime = Math.max(0, audio.currentTime - 5);
        break;
      case "ArrowUp":
      case "ArrowDown": {
        // When focus sits inside scrollable content, arrows scroll it natively.
        if (insideScrollableRegion(target)) break;
        event.preventDefault();
        const delta = event.key === "ArrowUp" ? 0.05 : -0.05;
        audio.volume = Math.min(1, Math.max(0, audio.volume + delta));
        els.volume.value = String(audio.volume);
        saveVolume();
        break;
      }
      case "s":
      case "S":
        toggleShuffle();
        break;
      case "r":
      case "R":
        cycleRepeat();
        break;
      case "l":
      case "L":
        toggleLyrics();
        break;
      default:
        break;
    }
  });

  const endSeek = () => {
    state.seeking = false;
  };
  els.seek.addEventListener("pointerdown", (event) => {
    state.seeking = true;
    try {
      els.seek.setPointerCapture(event.pointerId);
    } catch {
      // Older browsers may not support capture.
    }
  });
  els.seek.addEventListener("pointerup", endSeek);
  els.seek.addEventListener("pointercancel", endSeek);
  els.seek.addEventListener("lostpointercapture", endSeek);
  els.seek.addEventListener("input", () => {
    const duration = audio.duration || 0;
    if (!duration) return;
    const max = Number(els.seek.max) || 1000;
    const ratio = Number(els.seek.value) / max;
    els.timeElapsed.textContent = formatTime(ratio * duration);
  });
  els.seek.addEventListener("change", () => {
    const duration = audio.duration || 0;
    if (!duration) return;
    const max = Number(els.seek.max) || 1000;
    audio.currentTime = (Number(els.seek.value) / max) * duration;
    state.seeking = false;
    updateProgress();
  });

  els.volume.addEventListener("input", () => {
    audio.volume = Number(els.volume.value);
    saveVolume();
  });

  audio.addEventListener("timeupdate", updateProgress);
  audio.addEventListener("loadedmetadata", updateProgress);
  audio.addEventListener("play", updatePlayButton);
  audio.addEventListener("pause", () => {
    updatePlayButton();
    savePlaybackPosition();
  });
  audio.addEventListener("ended", () => playNext());

  // A missing or undecodable MP3 used to leave the player silently stalled.
  audio.addEventListener("error", () => {
    const current = getCurrentTrack();
    if (!current || !audio.getAttribute("src")) return;

    const unsupported =
      audio.error && audio.error.code === 4; // MEDIA_ERR_SRC_NOT_SUPPORTED
    showToast(
      `“${current.track.title}” ${unsupported ? "could not be decoded" : "could not be loaded"}. Skipping…`
    );
    audio.pause();
    removeValue(POSITION_KEY);
    window.setTimeout(() => playNext({ force: true }), 900);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") savePlaybackPosition();
  });
  window.addEventListener("pagehide", savePlaybackPosition);

  window.addEventListener("hashchange", () => {
    const route = parseHash();
    if (route.view === "album") showAlbum(route.albumId);
    else showHome();
  });
}

// Instant re-filter as the user types, without re-rendering the whole shell.
function bindSearch() {
  const input = document.getElementById("album-search");
  if (!input) return;
  input.value = state.query;
  input.addEventListener("input", () => {
    state.query = input.value;
    if (state.view === "home") renderHome();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      state.query = "";
      input.value = "";
      renderHome();
      input.blur();
    }
  });
}

async function init() {
  loadKaraokePreference();
  setTheme(getTheme());
  restoreVolume();
  bindEvents();
  renderSkeleton();
  bindSearch();

  try {
    const res = await fetch(CATALOG_URL, { cache: "no-cache" });
    if (!res.ok) throw new Error(`Failed to load catalog (${res.status})`);
    const data = await res.json();
    state.albums = (Array.isArray(data.albums) ? data.albums : []).map((album) => ({
      ...album,
      tracks: Array.isArray(album.tracks) ? album.tracks : [],
    }));
    lyricsCache.clear();
  } catch (error) {
    els.viewRoot.innerHTML = `
      <h1 class="view-title">Couldn’t load library</h1>
      <p class="view-sub">${escapeHtml(error.message)}</p>
      <p class="state-msg">If you opened index.html as a file, use a local static server so catalog.json can load.</p>
    `;
    return;
  }

  const route = parseHash();
  if (route.view === "album" && getAlbum(route.albumId)) {
    showAlbum(route.albumId);
  } else {
    showHome();
  }

  // Offer to pick up where the listener left off.
  const saved = loadSavedPlayback();
  if (saved) {
    const album = getAlbum(saved.albumId);
    const track = album?.tracks?.[saved.trackIndex];
    if (track) renderResumePrompt(track, saved);
  }

  updateNowPlaying();
  updatePlayButton();
}

/** Small dismissible card offering to resume the previous session. */
function renderResumePrompt(track, saved) {
  const existing = document.getElementById("resume-prompt");
  if (existing) existing.remove();

  const card = document.createElement("div");
  card.id = "resume-prompt";
  card.className = "resume-prompt";
  card.innerHTML = `
    <p class="resume-text">
      Resume <strong>${escapeHtml(track.title)}</strong>
      at ${escapeHtml(formatTime(saved.position))}?
    </p>
    <div class="resume-actions">
      <button type="button" class="ctrl ctrl-text" data-resume-yes>Resume</button>
      <button type="button" class="ctrl ctrl-text" data-resume-no>Not now</button>
    </div>
  `;

  card.addEventListener("click", async (event) => {
    if (event.target.closest("[data-resume-yes]")) {
      await playTrack(saved.albumId, saved.trackIndex, { autoplay: false });
      const applyPosition = () => {
        audio.currentTime = saved.position;
        updateProgress();
      };
      if (audio.readyState >= 1) applyPosition();
      else audio.addEventListener("loadedmetadata", applyPosition, { once: true });
      try {
        await audio.play();
      } catch {
        // Ignore autoplay blocking; the listener can press play.
      }
    }
    removeValue(LAST_TRACK_KEY);
    removeValue(POSITION_KEY);
    card.remove();
  });

  document.body.appendChild(card);
}

init();
