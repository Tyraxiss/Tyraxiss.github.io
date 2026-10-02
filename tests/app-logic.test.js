// Verifies the REAL shipped functions by extracting them from js/app.js.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const src = fs
  .readFileSync(path.join(ROOT, "js", "app.js"), "utf8")
  .replace(/\r\n/g, "\n");

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
  "formatTime",
  "parseLyricTimeToken",
  "parseLyricLine",
  "parseLrc",
  "parseVtt",
  "normalizeLyrics",
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
  { time: 1, text: "First line" },
  { time: 5, text: "Repeated" },
  { time: 9, text: "Repeated" },
  { time: 12, text: "Last" },
]);

// ---- VTT parsing
const vtt = api.parseVtt(
  ["WEBVTT", "", "1", "00:00:01.000 --> 00:00:03.000", "Hello <v Sam>world</v>", "", "2", "00:00:04.000 --> 00:00:06.000", "Second cue"].join("\n")
);
check("vtt cues", vtt, [
  { time: 1, text: "Hello world" },
  { time: 4, text: "Second cue" },
]);

// ---- normalizeLyrics dispatch
check("normalize picks lrc", api.normalizeLyrics("[00:01.00]Hi").length, 1);
check("normalize picks vtt", api.normalizeLyrics("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nYo").length, 1);
check("normalize plain lines", api.normalizeLyrics("a\nb\nc").length, 3);
check("normalize pipe", api.normalizeLyrics("12.5 | Sung").length, 1);
check("normalize empty", api.normalizeLyrics(""), []);
check("normalize null", api.normalizeLyrics(null), []);

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