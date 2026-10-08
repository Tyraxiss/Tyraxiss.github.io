// Static test server WITH HTTP Range support.
//
//   node tests/serve.cjs [port]     # default 8765, serves the repo root
//
// python -m http.server answers every request with 200 and no Accept-Ranges,
// so the browser cannot seek: a seek silently resets to 0 and any test that
// relies on jumping into a track fails (production on GitHub Pages answers
// 206 Partial Content). This server reproduces that behaviour locally.

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.argv[2]) || 8765;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".wav": "audio/wav",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".lrc": "text/plain; charset=utf-8",
  ".vtt": "text/vtt; charset=utf-8",
  ".srt": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".yml": "text/yaml; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8",
};

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
  } catch {
    res.writeHead(400);
    res.end("Bad request");
    return;
  }

  let filePath = path.normalize(path.join(ROOT, pathname));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  let stat;
  try {
    stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, "index.html");
      stat = fs.statSync(filePath);
    }
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found: " + pathname);
    return;
  }

  const type = TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
  const range = req.headers.range;

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!match) {
      res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
      res.end();
      return;
    }
    let start = match[1] ? Number(match[1]) : 0;
    let end = match[2] ? Number(match[2]) : stat.size - 1;
    if (!Number.isFinite(start) || start >= stat.size || end < start) {
      res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
      res.end();
      return;
    }
    end = Math.min(end, stat.size - 1);
    res.writeHead(206, {
      "Content-Type": type,
      "Accept-Ranges": "bytes",
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
      "Content-Length": end - start + 1,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Content-Length": stat.size,
  });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`serving ${ROOT} on http://127.0.0.1:${PORT}/ (Range supported)`);
});
