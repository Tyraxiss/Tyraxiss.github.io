// End-to-end MOBILE layout audit: measures whether the player bar and its
// transport controls are fully inside the viewport on real device sizes.
//
// This catches layout bugs unit tests cannot see. The classic one on this
// site: the app-shell is a 3-row grid (topbar / content / player). When the
// total intrinsic height of those rows exceeds the viewport, the bottom row
// (the player, with play/pause) is pushed off-screen and clipped.
//
// Usage: node tests/mobile.cjs [url]
// Defaults to http://localhost:8765/ (serve the repo root to run it).

const puppeteer = require("puppeteer");
const fs = require("fs");

const URL = process.argv[2] || "http://localhost:8765/";
const EDGE =
  process.env.BROWSER_PATH ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BROWSER_ARGS = [
  "--autoplay-policy=no-user-gesture-required",
  "--mute-audio",
  ...(process.env.CI ? ["--no-sandbox", "--disable-setuid-sandbox"] : []),
];

// Real-world viewport sizes, shortest-first (worst case for vertical space).
const DEVICES = [
  { name: "iPhone SE", width: 375, height: 667, dpr: 2 },
  { name: "iPhone 12", width: 390, height: 844, dpr: 3 },
  { name: "Pixel 5", width: 393, height: 851, dpr: 3 },
  { name: "Galaxy S8+", width: 412, height: 740, dpr: 3 },
  { name: "small landscape", width: 667, height: 375, dpr: 2 },
  { name: "tablet portrait", width: 768, height: 1024, dpr: 2 },
];

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

// Measures everything we need in a single round-trip.
async function measure(page) {
  return page.evaluate(() => {
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        height: Math.round(r.height),
        width: Math.round(r.width),
      };
    };
    const doc = document.documentElement;
    return {
      vh,
      vw,
      shell: rect(".app-shell"),
      player: rect(".player-bar"),
      transport: rect(".transport"),
      playBtn: rect("#btn-play"),
      timeline: rect(".timeline"),
      docScrollHeight: doc.scrollHeight,
      docClientHeight: doc.clientHeight,
      // Horizontal overflow is the other classic mobile defect.
      scrollWidth: doc.scrollWidth,
    };
  });
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: fs.existsSync(EDGE) ? EDGE : undefined,
    headless: "new",
    args: BROWSER_ARGS,
  });

  for (const device of DEVICES) {
    console.log("\n== " + device.name + " (" + device.width + "x" + device.height + ") ==");
    const page = await browser.newPage();
    await page.setViewport({
      width: device.width,
      height: device.height,
      deviceScaleFactor: device.dpr,
      isMobile: true,
      hasTouch: true,
    });

    try {
      await page.goto(URL, { waitUntil: "networkidle2", timeout: 30000 });
      await page.waitForSelector(".album-card", { timeout: 15000 });

      let m = await measure(page);

      // THE reported bug: player bar / play button clipped off the bottom.
      check(
        "player bar bottom is inside the viewport",
        m.player && m.player.bottom <= m.vh,
        m.player ? `bottom=${m.player.bottom} vh=${m.vh}` : "no .player-bar"
      );
      check(
        "play/pause button fully visible",
        m.playBtn && m.playBtn.bottom <= m.vh && m.playBtn.top >= 0,
        m.playBtn ? `top=${m.playBtn.top} bottom=${m.playBtn.bottom} vh=${m.vh}` : "missing"
      );
      check(
        "transport row fully visible",
        m.transport && m.transport.bottom <= m.vh,
        m.transport ? `bottom=${m.transport.bottom} vh=${m.vh}` : "missing"
      );
      check(
        "no vertical page scroll (app shell fits)",
        m.docScrollHeight <= m.docClientHeight + 1,
        `scrollHeight=${m.docScrollHeight} clientHeight=${m.docClientHeight}`
      );
      check(
        "no horizontal overflow",
        m.scrollWidth <= m.vw + 1,
        `scrollWidth=${m.scrollWidth} vw=${m.vw}`
      );

      // Now inside an album, where the layout is tallest (hero + track list).
      await page.click(".album-card");
      await page.waitForSelector(".track-row", { timeout: 10000 });
      m = await measure(page);
      check(
        "album view: player bar bottom inside viewport",
        m.player && m.player.bottom <= m.vh,
        m.player ? `bottom=${m.player.bottom} vh=${m.vh}` : "no .player-bar"
      );
      check(
        "album view: play/pause fully visible",
        m.playBtn && m.playBtn.bottom <= m.vh,
        m.playBtn ? `bottom=${m.playBtn.bottom} vh=${m.vh}` : "missing"
      );
      check(
        "album view: no vertical page scroll",
        m.docScrollHeight <= m.docClientHeight + 1,
        `scrollHeight=${m.docScrollHeight} clientHeight=${m.docClientHeight}`
      );

      // Transport controls must be big enough to tap with a thumb.
      if (m.playBtn) {
        check(
          "play button meets 40px touch target",
          m.playBtn.height >= 40 && m.playBtn.width >= 40,
          `${m.playBtn.width}x${m.playBtn.height}`
        );
      }
    } catch (err) {
      results.fail++;
      console.log("  FAIL " + device.name + " threw -> " + err.message);
    } finally {
      await page.close();
    }
  }

  await browser.close();
  console.log("\n" + results.pass + " passed, " + results.fail + " failed");
  return results.fail ? 1 : 0;
}

// Optional: dump PNGs of the home + album view for visual review.
//   node tests/mobile.cjs <url> --shots
async function shots() {
  const browser = await puppeteer.launch({
    executablePath: fs.existsSync(EDGE) ? EDGE : undefined,
    headless: "new",
    args: BROWSER_ARGS,
  });
  for (const device of DEVICES.slice(0, 4)) {
    const page = await browser.newPage();
    await page.setViewport({
      width: device.width,
      height: device.height,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    await page.goto(URL, { waitUntil: "networkidle2" });
    await page.waitForSelector(".album-card");
    await page.click(".album-card");
    await page.waitForSelector(".track-row");
    await page.screenshot({
      path: `tests/shot-${device.name.replace(/\s+/g, "-")}.png`,
    });
    await page.close();
  }
  await browser.close();
  console.log("wrote tests/shot-*.png");
}

const withShots = process.argv.includes("--shots");
main()
  .then(async (code) => {
    if (withShots) await shots();
    process.exit(code);
  })
  .catch((e) => {
    console.error("mobile audit crashed: " + e.message);
    process.exit(1);
  });