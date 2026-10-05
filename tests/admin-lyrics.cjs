// End-to-end lyrics checks against the site as visitors and editors use it.
//
// Usage: node tests/admin-lyrics.cjs [site-url]
// Defaults to http://localhost:8765/ (serve the repository root first).

const fs = require("fs");
const puppeteer = require("puppeteer");

const SITE_URL = process.argv[2] || "http://localhost:8765/";
const EDGE =
  process.env.BROWSER_PATH ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BROWSER_ARGS = [
  "--autoplay-policy=no-user-gesture-required",
  "--mute-audio",
  ...(process.env.CI ? ["--no-sandbox", "--disable-setuid-sandbox"] : []),
];

const results = { pass: 0, fail: 0 };
function check(label, ok, detail = "") {
  if (ok) {
    results.pass++;
    console.log(`  ok   ${label}`);
  } else {
    results.fail++;
    console.log(`  FAIL ${label}${detail ? ` -> ${detail}` : ""}`);
  }
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: fs.existsSync(EDGE) ? EDGE : undefined,
    headless: "new",
    args: BROWSER_ARGS,
  });

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(15000);

    const adminErrors = [];
    page.on("pageerror", (error) => adminErrors.push(error.message));
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(SITE_URL, { waitUntil: "networkidle2" });
    const libraryLink = 'a[href="./admin/lyrics-check.html"]';
    check("public player links to library tools", (await page.$(libraryLink)) !== null);
    await page.click(libraryLink);
    check("library tools link opens the lyrics dashboard", new URL(page.url()).pathname.endsWith("/admin/lyrics-check.html"), page.url());
    await page.waitForSelector("#check-lyrics");
    await page.click("#check-lyrics");
    await page.waitForFunction(() => {
      const summary = document.getElementById("summary");
      return summary?.dataset.state === "success" || summary?.dataset.state === "error";
    });

    const summary = await page.$eval("#summary", (node) => node.textContent.trim());
    const lyricResults = await page.$$eval("#results li", (items) =>
      items.map((item) => ({
        state: item.dataset.state,
        title: item.textContent,
        link: item.querySelector("a")?.href || "",
      }))
    );
    check("admin reports all published lyrics are working", summary === "All 16 linked lyric files loaded with timed lines.", summary);
    check("admin validates every linked lyrics file", lyricResults.length === 16, `checked ${lyricResults.length} files`);
    check("all linked lyric files are served and timestamped", lyricResults.every((item) => item.state === "success"), lyricResults.filter((item) => item.state !== "success").map((item) => item.title).join("; "));
    check("admin results link directly to lyric files", lyricResults.every((item) => item.link.endsWith(".lrc") || item.link.endsWith(".vtt")));
    check("lyrics dashboard has no script errors", adminErrors.length === 0, adminErrors.join(" | "));
    const editorLink = await page.$eval('a[href="./"]', (link) => new URL(link.href).pathname);
    check("lyrics dashboard links to the library editor", editorLink.endsWith("/admin/"), editorLink);

    await page.goto(new URL("index.html#/album/the-last-of-me", SITE_URL).href, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector('.track-row[data-play-track="1"]');
    await page.click('.track-row[data-play-track="1"]');
    await page.click("#btn-lyrics");
    await page.waitForSelector(".lyric-line");

    const lyrics = await page.$$eval(".lyric-line", (lines) =>
      lines.map((line) => ({
        time: line.dataset.time,
        text: line.textContent.trim(),
      }))
    );
    const karaokeEnabled = await page.$eval(
      "#lyrics-panel",
      (panel) => panel.classList.contains("is-karaoke")
    );
    check("song selection loads its linked LRC file", lyrics[0]?.text === "Oh, she's a blue-eyed angel.", lyrics[0]?.text);
    check("LRC timestamps are parsed for synchronized lyrics", lyrics[0]?.time === "12.9", lyrics[0]?.time);
    check("timed lyrics activate karaoke mode", karaokeEnabled);
  } catch (error) {
    check("browser lyrics audit completes", false, error.message);
  } finally {
    await browser.close();
  }

  console.log(`\n${results.pass} passed, ${results.fail} failed`);
  process.exitCode = results.fail ? 1 : 0;
}

main().catch((error) => {
  console.error("Browser lyrics audit crashed: " + error.message);
  process.exitCode = 1;
});
