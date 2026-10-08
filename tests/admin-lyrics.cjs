// End-to-end lyrics checks against the site as visitors use it.
//
// Usage: node tests/admin-lyrics.cjs [site-url]
// Defaults to http://localhost:8765/ (serve the repository root first).
//
// Expectations come from data/catalog.json instead of hardcoded counts or
// lyric text, so publishing another lyric file cannot break this test by
// itself - it checks structure and behaviour instead.

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

const SITE_URL = process.argv[2] || "http://localhost:8765/";
const ROOT = path.resolve(__dirname, "..");
const EDGE =
  process.env.BROWSER_PATH ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BROWSER_ARGS = [
  "--autoplay-policy=no-user-gesture-required",
  "--mute-audio",
  ...(process.env.CI ? ["--no-sandbox", "--disable-setuid-sandbox"] : []),
];

const catalog = JSON.parse(
  fs.readFileSync(path.join(ROOT, "data", "catalog.json"), "utf8")
);
const linked = (catalog.albums || []).flatMap((album) =>
  (album.tracks || [])
    .filter((track) => track.lyricsFile)
    .map((track) => ({ album, track }))
);
const EXPECTED = linked.length;

function localPath(siteRelative) {
  const clean = String(siteRelative)
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "");
  return path.join(ROOT, ...clean.split("/"));
}

function readFileSafe(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function hasWordTags(track) {
  return /<\d{1,2}:\d{2}[.,:]\d/.test(readFileSafe(localPath(track.lyricsFile)));
}

const wordEntry = linked.find((entry) => hasWordTags(entry.track));
const target = wordEntry || linked[0];
const enhancedTarget = Boolean(wordEntry);
const targetIndex = target ? target.album.tracks.indexOf(target.track) : -1;
const targetFile = target ? localPath(target.track.lyricsFile) : "";

const results = { pass: 0, fail: 0 };
function check(label, ok, detail = "") {
  if (ok) {
    results.pass++;
    console.log("  ok   " + label);
  } else {
    results.fail++;
    console.log("  FAIL " + label + (detail ? " -> " + detail : ""));
  }
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: fs.existsSync(EDGE) ? EDGE : undefined,
    headless: "new",
    args: BROWSER_ARGS,
  });

  check("catalog has linked lyrics to test", EXPECTED > 0, `found ${EXPECTED}`);

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(15000);
    await page.setViewport({ width: 1280, height: 900 });

    const adminErrors = [];
    page.on("pageerror", (error) => adminErrors.push(error.message));

    await page.goto(SITE_URL, { waitUntil: "networkidle2" });
    const libraryLink = 'a[href="./admin/lyrics-check.html"]';
    check("public player links to library tools", (await page.$(libraryLink)) !== null);
    await page.click(libraryLink);
    check(
      "library tools link opens the lyrics dashboard",
      new URL(page.url()).pathname.endsWith("/admin/lyrics-check.html"),
      page.url()
    );

    // ---- live check of every linked lyric file ---------------------------
    await page.waitForSelector("#check-lyrics");
    await page.click("#check-lyrics");
    await page.waitForFunction(() => {
      const summary = document.getElementById("summary");
      return summary?.dataset.state === "success" || summary?.dataset.state === "error";
    });

    const summary = await page.$eval("#summary", (node) => node.textContent.trim());
    const summaryMatch = summary.match(/^All (\d+) linked lyric files loaded with timed lines\.$/);
    check(
      "admin reports every published lyric file working",
      Boolean(summaryMatch) && Number(summaryMatch[1]) === EXPECTED,
      `${summary} (catalog has ${EXPECTED})`
    );

    const lyricResults = await page.$$eval("#results li", (items) =>
      items.map((item) => ({
        state: item.dataset.state,
        title: item.textContent,
        link: item.querySelector("a")?.href || "",
      }))
    );
    check(
      "admin validates every linked lyrics file",
      lyricResults.length === EXPECTED,
      `checked ${lyricResults.length} of ${EXPECTED}`
    );
    check(
      "all linked lyric files are served and timestamped",
      lyricResults.every((item) => item.state === "success"),
      lyricResults
        .filter((item) => item.state !== "success")
        .map((item) => item.title)
        .join("; ")
    );
    check(
      "admin results link directly to lyric files",
      lyricResults.every((item) => /\.(lrc|vtt|srt)$/i.test(item.link))
    );
    check("lyrics dashboard has no script errors", adminErrors.length === 0, adminErrors.join(" | "));
    const cmsLink = await page.$eval(
      'a[href="https://app.pagescms.org/"]',
      (link) => ({ href: link.href, rel: link.rel })
    );
    check(
      "lyrics dashboard links to Pages CMS safely",
      cmsLink.href === "https://app.pagescms.org/" && /noopener/.test(cmsLink.rel),
      JSON.stringify(cmsLink)
    );

    await page.goto(new URL("admin/", SITE_URL).href, { waitUntil: "networkidle2" });
    const launcher = await page.$eval(
      'a[href="https://app.pagescms.org/"]',
      (link) => ({ href: link.href, rel: link.rel, text: link.textContent })
    );
    check(
      "admin launcher links to the Pages CMS app",
      launcher.href === "https://app.pagescms.org/" && /noopener/.test(launcher.rel),
      JSON.stringify(launcher)
    );
    check(
      "admin launcher explains repository selection",
      (await page.$eval("main", (main) => main.textContent)).includes("Tyraxiss / Tyraxiss.github.io")
    );
    await page.goto(new URL("admin/lyrics-check.html", SITE_URL).href, { waitUntil: "networkidle2" });

    // ---- the lyrics lab parses with the player's own parser ---------------
    if (target) {
      const labInput = await page.$("#lab-file");
      await labInput.uploadFile(targetFile);
      await page.waitForFunction(() => {
        const facts = document.getElementById("lab-facts");
        return facts && !facts.hidden && facts.dataset.lines;
      });
      const facts = await page.$eval("#lab-facts", (node) => ({ ...node.dataset }));
      const note = await page.$eval("#lab-note", (node) => ({
        text: node.textContent,
        state: node.dataset.state,
      }));

      check(
        "lab detects the file format",
        enhancedTarget
          ? facts.format === "enhanced-lrc"
          : ["lrc", "webvtt", "srt", "text"].includes(facts.format),
        `${facts.format} for ${path.basename(targetFile)}`
      );
      check("lab counts parsed lines", Number(facts.lines) > 0, facts.lines);
      check("lab reports no parse errors", note.state !== "error", note.text);
      if (enhancedTarget) {
        check("lab counts word timings", Number(facts.words) > 0, facts.words);
        check(
          "lab says the file is ready for karaoke",
          /word timings|Ready to publish/i.test(note.text),
          note.text
        );
      }
      check("lab preview renders parsed lines", (await page.$$("#lab-preview .lab-line")).length > 0);
    }

    // ---- the public player renders and highlights the lyrics --------------
    await page.goto(new URL(`index.html#/album/${target.album.id}`, SITE_URL).href, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector(`.track-row[data-play-track="${targetIndex}"]`);
    await page.click(`.track-row[data-play-track="${targetIndex}"]`);
    await page.click("#btn-lyrics");
    await page.waitForSelector(".lyric-line");

    const lyrics = await page.$$eval(".lyric-line", (lines) =>
      lines.map((line) => ({
        time: line.dataset.time,
        text: line.textContent.trim(),
        words: line.querySelectorAll(".lyric-word").length,
        hasWords: line.classList.contains("has-words"),
      }))
    );
    const karaokeEnabled = await page.$eval("#lyrics-panel", (panel) =>
      panel.classList.contains("is-karaoke")
    );

    check("lyric lines are rendered", lyrics.length > 0, `${lyrics.length} lines`);
    check(
      "no raw word-timing markup reaches the screen",
      lyrics.every((line) => !/<\d{1,2}:\d{2}[.,:]/.test(line.text)),
      (lyrics.find((line) => /<\d{1,2}:\d{2}[.,:]/.test(line.text)) || {}).text
    );
    const firstLocal = readFileSafe(targetFile)
      .split(/\r?\n/)
      .find((line) => /^\[\d{1,2}:\d{2}/.test(line) || /\d{1,2}:\d{2}[.,]\d+\s*-->/.test(line));
    const expectedFirst = (firstLocal || "")
      .replace(/^\[[^\]]+\]\s*/, "")
      .replace(/<\d{1,2}:\d{2}[.,:]\d{1,3}>/g, "")
      .trim();
    check(
      "the player shows the file's own first line",
      lyrics.some((line) => line.text === expectedFirst) || !expectedFirst,
      `${lyrics[0]?.text} vs ${expectedFirst}`
    );
    check(
      "the first line carries a timestamp",
      Number.isFinite(Number(lyrics[0]?.time)),
      String(lyrics[0]?.time)
    );
    check("timed lyrics switch on karaoke mode", karaokeEnabled);

    if (enhancedTarget) {
      check(
        "word-by-word spans are rendered",
        lyrics.some((line) => line.hasWords && line.words > 0),
        JSON.stringify(lyrics.filter((line) => line.hasWords).length)
      );

      // Seek a few seconds in and confirm the active word actually advances.
      await page.waitForFunction(
        () => document.getElementById("time-duration").textContent !== "0:00",
        { timeout: 20000 }
      );
      for (let i = 0; i < 4; i += 1) {
        await page.keyboard.press("ArrowRight");
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      await page.waitForFunction(
        () => document.querySelectorAll(".lyric-word.is-active, .lyric-word.is-past").length > 0,
        { timeout: 10000 }
      );
      const activeState = await page.$$eval(
        ".lyric-line.is-active .lyric-word",
        (words) =>
          words.map((word) => ({
            active: word.classList.contains("is-active"),
            past: word.classList.contains("is-past"),
            text: word.textContent,
          }))
      );
      check(
        "the active line highlights word by word",
        activeState.length > 0 && activeState.some((word) => word.active || word.past),
        JSON.stringify(activeState.slice(0, 4))
      );
      check(
        "exactly one word is active",
        activeState.filter((word) => word.active).length <= 1,
        JSON.stringify(activeState.filter((word) => word.active))
      );
    }
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
