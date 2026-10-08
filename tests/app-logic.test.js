// Verifies the REAL shipped functions by extracting them from the player code.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const read = (name) =>
  fs.readFileSync(path.join(ROOT, "js", name), "utf8").replace(/\r\n/g, "\n");

// Player logic lives in js/app.js; lyric parsing lives in js/lyrics.js.
const src = [read("app.js"), read("lyrics.js")].join("\n");

// Pull a named top-level function declaration out of the source verbatim.
// These are all module-level declarations, so the function ends at the first
// "}" in column 0. (Counting braces naively breaks on regex quantifiers
// like \d{1,2}.)
function grab(name) {
  const marker = `function ${name}(`;
  const start = src.indexOf(marker);
  if (start === -1) throw new Error(`missing function: ${name}`);
  const end = src.indexOf("\n}\n", start);
  if (end === -1) throw new Error(`unterminated function: ${name}`);
  return src.slice(start, end + 2);
}

const NAMES = [
  // js/lyrics.js
  "wordTagSource",
  "hasWordTimings",
  "parseLyricTimeToken",
  "stripMarkup",
  "splitTimedWords",
  "parseLyricLine",
  "parseLrc",
  "parseVtt",
  "parseLyricsFile",
  "lyricsFormatLabel",
  "normalizeLyrics",
  // js/app.js
  "formatTime",
  "assetUrl",
  "escapeHtml",
  "escapeAttr",
  "pickShuffleIndex",
  "nextIndex",
  "prevIndex",
  "matchesQuery",
];

const code = NAMES.map(grab).join("\n\n");
const sandbox = {
  state: { shuffle: false, repeat: "off", shufflePlayed: [], query: "" },
  console,
  localStorage: null,
};
const factory = new Function(
  "state",
  code + "\nreturn {" +
    NAMES.map((n) => `${n}:${n}`).join(",") +
    "};"
);
const api = factory(sandbox.state);

let pass = 0;
let fail = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
  } else {
    fail++;
    console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
  }
}

// ---- formatTime
check("formatTime 0", api.formatTime(0), "0:00");
check("formatTime 65", api.formatTime(65), "1:05");
check("formatTime 305", api.formatTime(305), "5:05");
check("formatTime NaN", api.formatTime(NaN), "0:00");

// ---- time tokens
check("token 0:12", api.parseLyricTimeToken("0:12"), 12);
check("token 1:02.5", api.parseLyricTimeToken("1:02.5"), 62.5);
check("token 12.5", api.parseLyricTimeToken("12.5"), 12.5);
check("token 0:01:30", api.parseLyricTimeToken("0:01:30"), 90);
check("token 0:12,5", api.parseLyricTimeToken("0:12,5"), 12.5);
check("token junk", api.parseLyricTimeToken("ti:x"), null);

// ---- LRC parsing (multi-timestamp lines are the tricky case)
const lrc = api.parseLrc(
  ["[ti:Album]", "[ar:Artist]", "[00:01.00]First line", "[00:05.00][00:09.00]Repeated", "[00:12.00]Last"].join("\n")
);
check("lrc skips metadata + expands repeats", lrc, [
  { time: 1, text: "First line", words: null },
  { time: 5, text: "Repeated", words: null },
  { time: 9, text: "Repeated", words: null },
  { time: 12, text: "Last", words: null },
]);

// ---- enhanced LRC: word timings, never a raw <00:14.004> on screen
const enhanced = api.parseLyricsFile(
  [
    "[00:14.00]<00:14.004>Oh, <00:14.304>she's <00:14.625>a angel",
    "[00:17.35]<00:17.350>I can't",
    "[00:21.60]Untimed words line",
  ].join("\n"),
  "song.lrc"
);
check("enhanced format detected", enhanced.format, "enhanced-lrc");
check("enhanced is timed", enhanced.timed, true);
check("enhanced has word timings", enhanced.wordTimed, true);
check("enhanced line count", enhanced.lines.length, 3);
check("raw word tags stripped from text", enhanced.lines[0].text, "Oh, she's a angel");
check("word timings parsed", enhanced.lines[0].words, [
  { time: 14.004, text: "Oh, " },
  { time: 14.304, text: "she's " },
  { time: 14.625, text: "a angel" },
]);
check("single-tag line still word-timed", enhanced.lines[1].words, [
  { time: 17.35, text: "I can't" },
]);
check("line without tags stays line-timed", enhanced.lines[2].words, null);
check(
  "no raw tag survives anywhere",
  enhanced.lines.some((line) => /<\d{1,2}:\d{2}/.test(line.text)),
  false
);

// ---- standard LRC through the same entry point
const plain = api.parseLyricsFile("[00:01.00]Hello world", "a.lrc");
check("plain lrc format", plain.format, "lrc");
check("plain lrc no words", plain.lines[0].words, null);
check("token 00:00:01.500", api.parseLyricTimeToken("00:00:01.500"), 1.5);

// ---- VTT parsing
const vtt = api.parseVtt(
  ["WEBVTT", "", "1", "00:00:01.000 --> 00:00:03.000", "Hello <v Sam>world</v>", "", "2", "00:00:04.000 --> 00:00:06.000", "Second cue"].join("\n")
);
check("vtt cues", vtt, [
  { time: 1, text: "Hello world", words: null },
  { time: 4, text: "Second cue", words: null },
]);

const vttWord = api.parseLyricsFile(
  ["WEBVTT", "", "00:00:01.000 --> 00:00:04.000", "<00:00:01.000>Oh <00:00:02.000>yes"].join("\n"),
  "a.vtt"
);
check("vtt word format", vttWord.format, "webvtt-word");
check("vtt inline word timings", vttWord.lines[0].words, [
  { time: 1, text: "Oh " },
  { time: 2, text: "yes" },
]);
check("vtt inline text is clean", vttWord.lines[0].text, "Oh yes");

// ---- SRT (comma decimals, no WEBVTT header)
const srt = api.parseLyricsFile("1\n00:00:12,900 --> 00:00:14,000\nHi there", "subs.srt");
check("srt format", srt.format, "srt");
check("srt decimal comma parsed", srt.lines[0].time, 12.9);
check("srt text", srt.lines[0].text, "Hi there");

// ---- untimed text
const txt = api.parseLyricsFile("one\ntwo", "a.txt");
check("plain text format", txt.format, "text");
check("plain text untimed", txt.timed, false);
check("plain text lines", txt.lines.length, 2);

// ---- format labels (shown on the library tools page)
check("label enhanced", api.lyricsFormatLabel("enhanced-lrc"), "Enhanced LRC (line + word timing)");
check("label text", api.lyricsFormatLabel("text"), "Plain text (no timing)");

// ---- normalizeLyrics dispatch
check("normalize picks lrc", api.normalizeLyrics("[00:01.00]Hi").length, 1);
check("normalize picks vtt", api.normalizeLyrics("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nYo").length, 1);
check("normalize plain lines", api.normalizeLyrics("a\nb\nc").length, 3);
check("normalize pipe", api.normalizeLyrics("12.5 | Sung").length, 1);
check("normalize empty", api.normalizeLyrics(""), []);
check("normalize null", api.normalizeLyrics(null), []);
check("normalize keeps word timings", api.normalizeLyrics("[00:01.00]<00:01.20>Hi <00:01.50>there")[0].words.length, 2);

// ---- assetUrl (spaces + legacy prefixes)
check("assetUrl spaces", api.assetUrl("./Albums/Broken Thoughts/Album.png"), "./Albums/Broken%20Thoughts/Album.png");
check("assetUrl legacy", api.assetUrl("MP3-Website/Albums/x.mp3"), "./Albums/x.mp3");
check("assetUrl absolute", api.assetUrl("https://cdn.example/a.mp3"), "https://cdn.example/a.mp3");
check("assetUrl leading slash", api.assetUrl("/Albums/y.mp3"), "./Albums/y.mp3");

// ---- escaping (XSS guards)
check("escapeHtml", api.escapeHtml('<img src=x onerror="alert(1)">'), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
check("escapeAttr quote", api.escapeAttr("a'b\"c"), "a&#39;b&quot;c");

// ---- shuffle: never repeat until the album is exhausted
const state = sandbox.state;
const album = { tracks: [0, 1, 2, 3, 4] };
state.shuffle = true;
state.shufflePlayed = [];
const picked = new Set();
for (let i = 0; i < 5; i++) picked.add(api.pickShuffleIndex(album.tracks, -1));
check("shuffle covers whole album", picked.size, 5);

// ---- nextIndex / prevIndex
state.shuffle = false;
state.repeat = "off";
check("next sequential", api.nextIndex({ tracks: [1, 2, 3] }, 0), 1);
check("next stops at end", api.nextIndex({ tracks: [1, 2, 3] }, 2), null);
state.repeat = "all";
check("next wraps on repeat all", api.nextIndex({ tracks: [1, 2, 3] }, 2), 0);
state.repeat = "one";
check("repeat one holds", api.nextIndex({ tracks: [1, 2, 3] }, 1), 1);
state.repeat = "one";
check("repeat one skips on force", api.nextIndex({ tracks: [1, 2, 3] }, 1, { force: true }), 2);
check("next on empty album", api.nextIndex({ tracks: [] }, 0), null);

// ---- search matching
const albumA = { title: "Broken Thoughts", artist: "Brian J. Smith", year: 2024, tracks: [{ title: "Echoes" }] };
state.query = "";
check("empty query matches", api.matchesQuery(albumA), true);
state.query = "echo";
check("matches track title", api.matchesQuery(albumA), true);
state.query = "broken";
check("matches album title", api.matchesQuery(albumA), true);
state.query = "2024";
check("matches year", api.matchesQuery(albumA), true);
state.query = "zzzz";
check("rejects non-match", api.matchesQuery(albumA), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);