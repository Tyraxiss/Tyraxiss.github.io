const CATALOG_URL = "./data/catalog.json";
const THEME_KEY = "bs-theme";

const state = {
  albums: [],
  view: "home",
  albumId: null,
  current: null, // { albumId, trackIndex }
  shuffle: false,
  repeat: "off", // off | all | one
  seeking: false,
};

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
audio.volume = 0.85;

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
  lyricsSub: document.getElementById("lyrics-sub"),
  lyricsLines: document.getElementById("lyrics-lines"),
};

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
  const track = album.tracks[state.current.trackIndex];
  if (!track) return null;
  return { album, track, trackIndex: state.current.trackIndex };
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
    return { view: "album", albumId: decodeURIComponent(parts[1]) };
  }
  return { view: "home", albumId: null };
}

function normalizeLyrics(lyrics) {
  if (!lyrics) return [];
  if (!Array.isArray(lyrics)) return [];
  return lyrics
    .map((line) => {
      if (typeof line === "string") return { time: null, text: line };
      if (line && typeof line.text === "string") {
        const time =
          typeof line.time === "number" && Number.isFinite(line.time)
            ? line.time
            : null;
        return { time, text: line.text };
      }
      return null;
    })
    .filter(Boolean);
}

function renderSidebar() {
  els.albumNav.innerHTML = state.albums
    .map(
      (album) => `
      <button
        type="button"
        class="album-nav-btn${state.view === "album" && state.albumId === album.id ? " is-active" : ""}"
        data-album-id="${album.id}"
      >
        ${escapeHtml(album.title)}
      </button>`
    )
    .join("");
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

  els.viewRoot.innerHTML = `
    <div class="home-intro">
      <h1>Brian J. Smith</h1>
      <p>A quiet place for the albums — open one and press play.</p>
    </div>
    <div class="album-grid">
      ${state.albums
        .map(
          (album) => `
        <button type="button" class="album-card" data-open-album="${album.id}">
          <div class="album-card-art-wrap album-frame">
            <img src="${escapeAttr(assetUrl(album.cover))}" alt="" loading="lazy" />
          </div>
          <p class="album-card-title">${escapeHtml(album.title)}</p>
          <p class="album-card-meta">${album.tracks.length} tracks${album.year ? ` · ${album.year}` : ""}</p>
        </button>`
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
  const yearBit = album.year ? ` · ${album.year}` : "";

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
          ${escapeHtml(album.artist)}${yearBit} · ${album.tracks.length} tracks
        </p>
      </div>
    </div>
    <div class="track-list" role="list">
      ${album.tracks
        .map((track, index) => {
          const isCurrent =
            current &&
            current.album.id === album.id &&
            current.trackIndex === index;
          return `
          <button
            type="button"
            class="track-row${isCurrent ? " is-current" : ""}"
            data-play-track="${index}"
            role="listitem"
          >
            <span class="track-num">${String(index + 1).padStart(2, "0")}</span>
            <span class="track-title">${escapeHtml(track.title)}</span>
            <span class="track-dur">${formatTime(track.duration)}</span>
          </button>`;
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
  if (!album) return;
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

async function playTrack(albumId, trackIndex, { autoplay = true } = {}) {
  const album = getAlbum(albumId);
  if (!album || !album.tracks[trackIndex]) return;

  state.current = { albumId, trackIndex };
  const track = album.tracks[trackIndex];
  audio.src = assetUrl(track.src);
  updateNowPlaying();
  renderView();
  renderLyrics();
  applyCoverAtmosphere(album.cover);

  if (autoplay) {
    try {
      await audio.play();
    } catch {
      // Autoplay may be blocked until a user gesture; controls still work.
    }
  }
  updatePlayButton();
}

function nextIndex(album, fromIndex, { force = false } = {}) {
  if (state.repeat === "one" && !force) return fromIndex;

  if (state.shuffle) {
    if (album.tracks.length <= 1) return fromIndex;
    let next = fromIndex;
    while (next === fromIndex) {
      next = Math.floor(Math.random() * album.tracks.length);
    }
    return next;
  }

  const next = fromIndex + 1;
  if (next < album.tracks.length) return next;
  if (state.repeat === "all") return 0;
  return null;
}

function prevIndex(album, fromIndex) {
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return fromIndex;
  }
  if (state.shuffle) {
    return nextIndex(album, fromIndex, { force: true });
  }
  const prev = fromIndex - 1;
  if (prev >= 0) return prev;
  if (state.repeat === "all") return album.tracks.length - 1;
  return 0;
}

async function playNext({ force = false } = {}) {
  const current = getCurrentTrack();
  if (!current) return;
  const next = nextIndex(current.album, current.trackIndex, { force });
  if (next === null) {
    audio.pause();
    updatePlayButton();
    return;
  }
  await playTrack(current.album.id, next);
}

async function playPrev() {
  const current = getCurrentTrack();
  if (!current) return;
  const prev = prevIndex(current.album, current.trackIndex);
  await playTrack(current.album.id, prev);
}

function toggleShuffle() {
  state.shuffle = !state.shuffle;
  els.btnShuffle.setAttribute("aria-pressed", String(state.shuffle));
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

function renderLyrics() {
  const current = getCurrentTrack();
  if (!current) {
    els.lyricsSub.textContent = "";
    els.lyricsLines.innerHTML = `<p class="lyric-empty">Nothing playing</p>`;
    return;
  }

  els.lyricsSub.textContent = `${current.track.title} · ${current.album.title}`;
  const lines = normalizeLyrics(current.track.lyrics);

  if (!lines.length) {
    els.lyricsLines.innerHTML = `<p class="lyric-empty">No lyrics for this track yet.</p>`;
    return;
  }

  els.lyricsLines.innerHTML = lines
    .map(
      (line, i) =>
        `<p class="lyric-line" data-lyric-index="${i}" data-time="${line.time ?? ""}">${escapeHtml(line.text)}</p>`
    )
    .join("");
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
  if (!hasTimestamps) return;

  let active = 0;
  for (let i = 0; i < times.length; i += 1) {
    const t = times[i];
    if (typeof t === "number" && t <= currentTime) active = i;
  }

  nodes.forEach((node, i) => {
    const on = i === active;
    node.classList.toggle("is-active", on);
    if (on) {
      node.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  });
}

function openLyrics() {
  renderLyrics();
  els.lyricsPanel.hidden = false;
  els.btnLyrics.setAttribute("aria-pressed", "true");
  updateLyricsHighlight(audio.currentTime || 0);
}

function closeLyrics() {
  els.lyricsPanel.hidden = true;
  els.btnLyrics.setAttribute("aria-pressed", "false");
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
  // CMS may store absolute Paths like /MP3-Website/Albums/... — normalize to site-relative.
  normalized = normalized.replace(/^\/MP3-Website\//i, "");
  normalized = normalized.replace(/^\.\//, "");
  normalized = normalized.replace(/^\//, "");

  return (
    "./" +
    normalized
      .split("/")
      .filter(Boolean)
      .map((part) => encodeURIComponent(part))
      .join("/")
  );
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
    if (audio.paused) await audio.play();
    else audio.pause();
    updatePlayButton();
  });

  els.btnNext.addEventListener("click", () => playNext({ force: true }));
  els.btnPrev.addEventListener("click", playPrev);
  els.btnShuffle.addEventListener("click", toggleShuffle);
  els.btnRepeat.addEventListener("click", cycleRepeat);
  els.btnLyrics.addEventListener("click", toggleLyrics);

  els.lyricsPanel.addEventListener("click", (event) => {
    if (event.target.closest("[data-close-lyrics]")) closeLyrics();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.lyricsPanel.hidden) closeLyrics();
  });

  els.seek.addEventListener("pointerdown", () => {
    state.seeking = true;
  });
  els.seek.addEventListener("pointerup", () => {
    state.seeking = false;
  });
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
  });

  audio.addEventListener("timeupdate", updateProgress);
  audio.addEventListener("loadedmetadata", updateProgress);
  audio.addEventListener("play", updatePlayButton);
  audio.addEventListener("pause", updatePlayButton);
  audio.addEventListener("ended", () => playNext());

  window.addEventListener("hashchange", () => {
    const route = parseHash();
    if (route.view === "album") showAlbum(route.albumId);
    else showHome();
  });
}

async function init() {
  setTheme(getTheme());
  bindEvents();

  try {
    const res = await fetch(CATALOG_URL);
    if (!res.ok) throw new Error(`Failed to load catalog (${res.status})`);
    const data = await res.json();
    state.albums = Array.isArray(data.albums) ? data.albums : [];
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
  updateNowPlaying();
  updatePlayButton();
}

init();
