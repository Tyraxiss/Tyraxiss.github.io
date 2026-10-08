/**
 * Lyrics parsing shared by the public player (js/app.js) and the library
 * tools page (admin/lyrics-check.html).
 *
 * Supported inputs:
 *   - plain text        one lyric line per row, no timing
 *   - LRC               [00:12.34] line lyrics (line-by-line timing)
 *   - enhanced LRC      [00:12.34]<00:12.50>word <00:12.80>by word
 *   - WebVTT            cue timings, optional inline <00:00:12.345> word stamps
 *   - SRT               subtitle timings (parsed like WebVTT, "," decimals)
 *
 * Every parsed line is:
 *   { time: number|null, text: string, words: null | [{ time, text }] }
 *
 * `time` drives line-by-line highlighting; `words` (when present) drives
 * word-by-word karaoke. `text` is always the plain text with every timing
 * tag removed, so raw `<00:14.004>` markup can never reach the screen.
 *
 * Every exported value is a function declaration with no module-level
 * bindings, because tests/app-logic.test.js extracts these functions
 * verbatim out of this file to test the real shipped code.
 */

/** Regex source for a word-timing tag: <00:14.004> or <00:00:14.004>. */
function wordTagSource() {
  return "<((?:\\d{1,3}:)?\\d{1,2}:\\d{2}(?:[.,:]\\d{1,3})?)>";
}

/** True when the text carries enhanced-LRC / WebVTT word-level timestamps. */
export function hasWordTimings(text) {
  return new RegExp(wordTagSource()).test(String(text ?? ""));
}

/** Parse "12.34", "1:02.5", "0:01:30" or "00:01:30.500" into seconds. */
export function parseLyricTimeToken(token) {
  const raw = String(token ?? "").trim().replace(",", ".");
  if (!raw) return null;

  const parts = raw.split(":");
  if (parts.length === 3) {
    const hours = Number(parts[0]);
    const minutes = Number(parts[1]);
    const seconds = Number(parts[2]);
    if (![hours, minutes, seconds].every(Number.isFinite)) return null;
    return hours * 3600 + minutes * 60 + seconds;
  }

  if (parts.length === 2) {
    const minutes = Number(parts[0]);
    const seconds = Number(parts[1]);
    if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
    return minutes * 60 + seconds;
  }

  const seconds = Number(raw);
  return Number.isFinite(seconds) ? seconds : null;
}

/** Remove WebVTT/SSML speaker and style markup: <v Sam>, </v>, <b>, <i>. */
export function stripMarkup(text) {
  return String(text ?? "").replace(/<\/?(?:[A-Za-z][A-Za-z0-9-]*)(?:\s[^<>]*)?>/g, "");
}

/**
 * Split one lyric chunk into word-level timings.
 *
 *   splitTimedWords("<00:14.004>Oh, <00:14.304>she's", 14)
 *     -> { text: "Oh, she's", words: [{time: 14.004, text: "Oh, "}, ...] }
 *
 * Chunks without any timing tag return `words: null` (line timing only).
 * `fallbackTime` is used for untimed text sitting in front of the first tag.
 */
export function splitTimedWords(body, fallbackTime = null) {
  const raw = String(body ?? "");
  const parts = raw.split(new RegExp(wordTagSource()));
  if (parts.length < 3) return { text: stripMarkup(raw).trim(), words: null };

  // Rebuild the plain line from the text chunks so timing tags never survive.
  let rawPlain = parts[0];
  for (let i = 2; i < parts.length; i += 2) rawPlain += parts[i];
  const plain = stripMarkup(rawPlain).trim();

  const words = [];
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const time = parseLyricTimeToken(parts[i]);
    const text = stripMarkup(parts[i + 1]);
    if (time == null || !text) continue;
    words.push({ time, text });
  }
  if (!words.length) return { text: plain, words: null };

  const leading = stripMarkup(parts[0]);
  if (leading.trim()) words.unshift({ time: fallbackTime ?? words[0].time, text: leading });

  // Keep timings monotonic even when a file has a stray backwards stamp.
  for (let i = 1; i < words.length; i += 1) {
    if (words[i].time < words[i - 1].time) words[i].time = words[i - 1].time;
  }

  return { text: plain, words };
}

/**
 * One physical line of lyric text:
 *   "[00:12.34] words", "12.34 | words", "0:12 | words" or bare text.
 */
export function parseLyricLine(line) {
  const text = String(line ?? "").trim();
  if (!text) return null;

  // [00:12.5] Lyric text   or   [12.5] Lyric text
  const bracket = text.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (bracket) {
    const time = parseLyricTimeToken(bracket[1]);
    const body = bracket[2].trim();
    if (body) {
      const split = splitTimedWords(body, time);
      return { time, text: split.text, words: split.words };
    }
  }

  // 12.5 | Lyric text   or   0:12 | Lyric text
  const pipe = text.match(/^([^|]+)\|\s*(.+)$/);
  if (pipe) {
    const time = parseLyricTimeToken(pipe[1]);
    if (time != null) {
      const split = splitTimedWords(pipe[2].trim(), time);
      return { time, text: split.text, words: split.words };
    }
  }

  const split = splitTimedWords(text, null);
  return { time: null, text: split.text, words: split.words };
}

/** Parse LRC / enhanced LRC. Multi-timestamp lines are expanded. */
export function parseLrc(text) {
  const lines = [];

  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    // Skip metadata tags like [ti:], [ar:], [offset:]
    if (/^\[[a-zA-Z]/.test(line)) continue;

    const times = [];
    let rest = line;
    let match = rest.match(/^\[([^\]]+)\]/);
    while (match) {
      const time = parseLyricTimeToken(match[1]);
      if (time != null) times.push(time);
      rest = rest.slice(match[0].length).trimStart();
      match = rest.match(/^\[([^\]]+)\]/);
    }

    const body = rest.trim();
    if (!body) continue;

    const stamps = times.length ? times : [null];
    for (const time of stamps) {
      const split = splitTimedWords(body, time);
      if (split.text) lines.push({ time, text: split.text, words: split.words });
    }
  }

  return lines.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
}

/** Parse WebVTT (and SRT, which shares the "-->" block layout). */
export function parseVtt(text) {
  const cleaned = String(text)
    .replace(/^\uFEFF/, "")
    .replace(/^WEBVTT[^\n]*\n?/i, "");
  const blocks = cleaned.split(/\n\s*\n/);
  const lines = [];

  for (const block of blocks) {
    const parts = block
      .split(/\r?\n/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (!parts.length || parts[0].startsWith("NOTE")) continue;

    let timingIndex = 0;
    if (parts[0] && !parts[0].includes("-->")) timingIndex = 1;
    const timing = parts[timingIndex];
    if (!timing || !timing.includes("-->")) continue;

    const startToken = timing.split("-->")[0].trim().split(/\s+/)[0];
    const time = parseLyricTimeToken(startToken);
    const cueLines = parts.slice(timingIndex + 1);

    for (const cueLine of cueLines) {
      const split = splitTimedWords(cueLine, time);
      if (split.text) lines.push({ time, text: split.text, words: split.words });
    }
  }

  return lines;
}

/**
 * Parse any supported lyrics payload and report what it was.
 *
 * Returns { lines, format, timed, wordTimed } where format is one of
 * "lrc", "enhanced-lrc", "webvtt", "webvtt-word", "srt", "srt-word", "text".
 */
export function parseLyricsFile(text, filename = "") {
  const body = String(text ?? "").replace(/^\uFEFF/, "");
  const name = String(filename ?? "").toLowerCase();
  const hasVttHeader = /^\s*WEBVTT/i.test(body);
  const isSrt =
    name.endsWith(".srt") ||
    (!hasVttHeader && /\d{1,2}:\d{2},\d{1,3}\s*-->/.test(body));
  const isVtt = name.endsWith(".vtt") || hasVttHeader || (!isSrt && /-->/.test(body));

  let lines;
  let format;

  if (isVtt || isSrt) {
    lines = parseVtt(body);
    const base = isSrt ? "srt" : "webvtt";
    format = lines.some((line) => line.words?.length) ? `${base}-word` : base;
  } else if (/\[\d{1,2}:\d{2}/.test(body) || /^\s*\d+(?:\.\d+)?\s*\|/m.test(body)) {
    lines = parseLrc(body);
    format = hasWordTimings(body) ? "enhanced-lrc" : "lrc";
  } else {
    lines = body
      .split(/\r?\n/)
      .map(parseLyricLine)
      .filter((line) => line && line.text);
    format = "text";
  }

  const timed = lines.some((line) => typeof line.time === "number" && Number.isFinite(line.time));
  const wordTimed = lines.some((line) => line.words?.length);
  if (!timed && format !== "text") format = "text";

  return { lines, format, timed, wordTimed };
}

/** Human label for a format id, used by the library tools page. */
export function lyricsFormatLabel(format) {
  switch (format) {
    case "enhanced-lrc":
      return "Enhanced LRC (line + word timing)";
    case "lrc":
      return "LRC (line timing)";
    case "webvtt-word":
      return "WebVTT (line + word timing)";
    case "webvtt":
      return "WebVTT (line timing)";
    case "srt-word":
      return "SRT (line + word timing)";
    case "srt":
      return "SRT (line timing)";
    default:
      return "Plain text (no timing)";
  }
}

/**
 * Normalize whatever the CMS stored (multiline string, pasted LRC/VTT, or an
 * array of { time, text } / "time | text" entries) into lyric lines.
 */
export function normalizeLyrics(lyrics) {
  if (!lyrics) return [];

  if (typeof lyrics === "string") {
    const trimmed = lyrics.trim();
    if (!trimmed) return [];
    return parseLyricsFile(trimmed).lines;
  }

  if (!Array.isArray(lyrics)) return [];

  return lyrics
    .map((line) => {
      if (typeof line === "string") return parseLyricLine(line);
      if (line && typeof line.text === "string") {
        const time =
          typeof line.time === "number" && Number.isFinite(line.time) ? line.time : null;
        const split = splitTimedWords(line.text.trim(), time);
        return { time, text: split.text, words: split.words };
      }
      return null;
    })
    .filter((line) => line && line.text);
}
