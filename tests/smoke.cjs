// End-to-end smoke test: drives the real page in a real browser.
//
// Usage: node tests/smoke.cjs [url]
// Defaults to http://localhost:8765/ (serve the repo root to run it).
//
// Verifies what unit tests cannot: that the catalog loads, the player renders
// real tracks, search filters, navigation works, and a real MP3 reaches
// "canplay" with a sane duration.

const puppeteer = require("puppeteer");
const fs = require("fs");

const URL = process.argv[2] || "http://localhost:8765/";
const EDGE =
  process.env.BROWSER_PATH ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const results = { pass: 0, fail: 0 };
function check(label, ok, detail) {
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
    args: [
      "--autoplay-policy=no-user-gesture-required",
      "--mute-audio",
      ...(process.env.CI ? ["--no-sandbox", "--disable-setuid-sandbox"] : []),
    ],
  });

  const page = await browser.newPage();
  const consoleErrors = [];
  const missing = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));
  page.on("response", (r) => {
    if (r.status() >= 400) missing.push(r.status() + " " + r.url());
  });

  try {
    await page.goto(URL, { waitUntil: "networkidle2", timeout: 30000 });

    // ---- catalog actually loaded -------------------------------------
    await page.waitForSelector(".album-card", { timeout: 15000 });
    const albumCount = await page.$$eval(".album-card", (n) => n.length);
    check("home grid renders albums", albumCount === 5, "got " + albumCount);
    check("loading skeleton is replaced", (await page.$(".skeleton-card")) === null);

    // ---- search filters ----------------------------------------------
    await page.type("#album-search", "echoes");
    await page.waitForFunction(
      () => document.querySelectorAll(".album-card").length < 5,
      { timeout: 5000 }
    );
    const filtered = await page.$$eval(".album-card", (n) => n.length);
    check("search narrows results", filtered > 0 && filtered < 5, "got " + filtered);
    check("search note is shown", (await page.$(".search-note")) !== null);

    // Escape inside the search box is wired to clear the filter.
    await page.click("#album-search");
    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () => document.querySelectorAll(".album-card").length === 5,
      { timeout: 5000 }
    );
    check("Escape clears the search", true);

    // ---- navigation ---------------------------------------------------
    await page.click(".album-card");
    await page.waitForSelector(".track-row", { timeout: 10000 });
    const trackCount = await page.$$eval(".track-row", (n) => n.length);
    check("album view lists tracks", trackCount > 0, "got " + trackCount);
    check("Play All button present", (await page.$("[data-play-album-all]")) !== null);
    check("Shuffle button present", (await page.$("[data-shuffle-album-all]")) !== null);
    check("download link present", (await page.$(".track-tools a[download]")) !== null);
    check("hash reflects album route", (await page.url()).includes("#/album/"));

    // ---- real audio reaches canplay ----------------------------------
    await page.evaluate(() => document.querySelector(".track-row").click());
    await page.waitForFunction(
      () => {
        const el = document.getElementById("time-duration");
        return el && el.textContent && el.textContent !== "0:00";
      },
      { timeout: 20000 }
    );
    const durationText = await page.$eval("#time-duration", (n) => n.textContent);
    check("real duration read from the MP3", /\d+:\d\d/.test(durationText), durationText);

    const npTitle = await page.$eval("#np-title", (n) => n.textContent.trim());
    check(
      "now-playing shows the track",
      npTitle.length > 0 && npTitle !== "Nothing playing",
      npTitle
    );
    const pageTitle = await page.title();
    check("document title updates on play", pageTitle.includes(npTitle), pageTitle);

    await partTwo(page, consoleErrors, missing);
  } catch (err) {
    results.fail++;
    console.log("  FAIL harness threw: " + err.message);
  } finally {
    await browser.close();
  }

  console.log("\n" + results.pass + " passed, " + results.fail + " failed");
  process.exit(results.fail ? 1 : 0);
}

async function partTwo(page, consoleErrors, missing) {
  // ---- volume persistence -------------------------------------------
  await page.evaluate(() => {
    const v = document.getElementById("volume");
    v.value = "0.42";
    v.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const storedVolume = await page.evaluate(() => localStorage.getItem("bs-volume"));
  check("volume persisted to localStorage", storedVolume === "0.42", String(storedVolume));

  // ---- lyrics panel + keyboard --------------------------------------
  await page.keyboard.press("l");
  await page.waitForSelector("#lyrics-panel:not([hidden])", { timeout: 5000 });
  check("L opens the lyrics panel", true);
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => document.getElementById("lyrics-panel").hidden,
    { timeout: 5000 }
  );
  check("Escape closes the lyrics panel", true);

  await page.keyboard.press("s");
  const shuffleOn = await page.$eval("#btn-shuffle", (n) => n.getAttribute("aria-pressed"));
  check("S toggles shuffle", shuffleOn === "true", shuffleOn);
  await page.keyboard.press("r");
  const repeatOn = await page.$eval("#btn-repeat", (n) => n.getAttribute("aria-pressed"));
  check("R cycles repeat", repeatOn === "true", repeatOn);

  // ---- back home via hash routing ------------------------------------
  await page.evaluate(() => {
    location.hash = "#/";
  });
  await page.waitForSelector(".album-card", { timeout: 5000 });
  check("hash routing returns home", true);

  // ---- toast styling -------------------------------------------------
  const toastStyled = await page.evaluate(() => {
    const el = document.createElement("div");
    el.className = "toast is-visible";
    el.textContent = "probe";
    document.body.appendChild(el);
    const ok = getComputedStyle(el).position === "fixed";
    el.remove();
    return ok;
  });
  check("toast styles are applied", toastStyled);
  check("no console errors", consoleErrors.length === 0, consoleErrors.join(" | "));
  check(
    "no failed requests",
    missing.filter((m) => !m.includes("favicon")).length === 0,
    missing.join(" | ")
  );
}

main();