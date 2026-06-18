/**
 * screenshot.mjs
 *
 * Headless Playwright/Chromium screenshot tool for the Branch canvas.
 *
 * USAGE
 *   # Start the dev server first:
 *   cd src/client && npm run dev
 *
 *   # Then in another terminal (or same if backgrounded):
 *   cd src/client && npm run screenshot
 *
 *   # Options:
 *   npm run screenshot -- --url=http://localhost:5173 --out=/path/to/canvas.png
 *
 * The script polls the WebGL canvas for non-blank pixels after page load.
 * If the canvas stays blank (all pixels match the dark background) for more
 * than BLANK_TIMEOUT_MS it prints an error and exits with code 1.
 * This is the critical anti-regression guard — it catches the exact class of
 * bug shipped in issue #3 (node rendered black/invisible).
 *
 * ASSUMES: a Vite dev server (or any server) is already running at the target
 * URL.  The script does NOT spawn a server itself.
 *
 * SCREENSHOT MECHANISM
 *   Playwright's CDP-based element.screenshot() does not reliably read back
 *   WebGL draw buffer pixels in headless Chromium.  Instead, we export
 *   directly from the in-page WebGL canvas using canvas.toDataURL("image/png"),
 *   which reads from the same retained buffer that readPixels sees
 *   (preserveDrawingBuffer:true is set in scene.js).  This is the correct
 *   approach for WebGL content.
 */

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// ---------------------------------------------------------------------------
// CLI arg parsing  --url=...  --out=...
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);

function getArg(name) {
  const prefix = `--${name}=`;
  const found = args.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../.."); // src/client/scripts -> repo root

const TARGET_URL = getArg("url") ?? "http://localhost:5173";
const OUTPUT_PATH = getArg("out")
  ? resolve(getArg("out"))
  : resolve(REPO_ROOT, "docs/screenshots/canvas.png");

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------
const VIEWPORT = { width: 1000, height: 800 };

// Background clear color from scene.js: Color4(0.05, 0.05, 0.05, 1)
// In 0-255 space that's ~12.75, rounded to 13.  Allow a small tolerance band.
const BG_R = 13;
const BG_G = 13;
const BG_B = 13;
const BG_TOLERANCE = 15; // pixels within this Manhattan distance are "blank"

// How many of the sampled pixels must differ from the background before we
// consider the canvas "painted".  With a 10x10 grid (100 samples) and the
// current single-node scene covering roughly 6% of the 1000x800 canvas, we
// expect around 6 hits.  We require 3% (>= 3 of 100) rather than a single
// pixel: one stray non-background pixel (an antialiased edge, a UI texel)
// must NOT be enough to mask a broken render — the whole point of this guard
// is to fail loudly when the main scene content is missing (issue #3).
//
// NOTE: this threshold is calibrated to the current single-node layout. As
// the scene grows (multi-node, edges, panels) revisit it — ideally key the
// check to expected foreground content rather than a flat fraction.
const NON_BLANK_FRACTION_REQUIRED = 0.03;

// Grid of sample points across the canvas (rows x cols = 100 samples)
const SAMPLE_ROWS = 10;
const SAMPLE_COLS = 10;

// How long to wait for the canvas to become non-blank before giving up
const BLANK_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 300;

// ---------------------------------------------------------------------------
// Non-blank check — runs inside the page via page.evaluate()
// ---------------------------------------------------------------------------
function nonBlankCheckFn({
  bgR,
  bgG,
  bgB,
  bgTolerance,
  sampleRows,
  sampleCols,
}) {
  const canvas = document.querySelector("canvas");
  if (!canvas) return { error: "no canvas element found" };

  // WebGL readPixels path — reads directly from the retained draw buffer.
  // preserveDrawingBuffer:true (set in scene.js) ensures the frame is kept.
  const gl =
    canvas.getContext("webgl") ||
    canvas.getContext("webgl2") ||
    canvas.getContext("experimental-webgl");

  if (gl) {
    const cw = canvas.width;
    const ch = canvas.height;
    const total = sampleRows * sampleCols;
    let nonBlank = 0;
    const pixelBuf = new Uint8Array(4);

    for (let row = 0; row < sampleRows; row++) {
      for (let col = 0; col < sampleCols; col++) {
        const x = Math.floor(((col + 0.5) / sampleCols) * cw);
        // WebGL Y-axis is flipped vs CSS: y=0 is the bottom of the canvas
        const yGL = ch - 1 - Math.floor(((row + 0.5) / sampleRows) * ch);
        gl.readPixels(x, yGL, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixelBuf);
        const dist =
          Math.abs(pixelBuf[0] - bgR) +
          Math.abs(pixelBuf[1] - bgG) +
          Math.abs(pixelBuf[2] - bgB);
        if (dist > bgTolerance) nonBlank++;
      }
    }

    return { fraction: nonBlank / total, method: "webgl-readPixels" };
  }

  // Fallback: draw to an offscreen 2d canvas and read with getImageData.
  // This works when preserveDrawingBuffer:true is set (the GL buffer isn't
  // cleared before toDataURL / drawImage can copy it).
  const offscreen = document.createElement("canvas");
  offscreen.width = canvas.width;
  offscreen.height = canvas.height;
  const ctx2d = offscreen.getContext("2d");
  ctx2d.drawImage(canvas, 0, 0);
  const total = sampleRows * sampleCols;
  let nonBlank = 0;

  for (let row = 0; row < sampleRows; row++) {
    for (let col = 0; col < sampleCols; col++) {
      const x = Math.floor(((col + 0.5) / sampleCols) * canvas.width);
      const y = Math.floor(((row + 0.5) / sampleRows) * canvas.height);
      const px = ctx2d.getImageData(x, y, 1, 1).data;
      const dist =
        Math.abs(px[0] - bgR) + Math.abs(px[1] - bgG) + Math.abs(px[2] - bgB);
      if (dist > bgTolerance) nonBlank++;
    }
  }

  return { fraction: nonBlank / total, method: "2d-fallback" };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
let browser;

async function run() {
  console.log(`[screenshot] Target URL : ${TARGET_URL}`);
  console.log(`[screenshot] Output path: ${OUTPUT_PATH}`);

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize(VIEWPORT);

  // Navigate and wait for network to go idle (scripts loaded & executed)
  console.log("[screenshot] Navigating...");
  await page.goto(TARGET_URL, { waitUntil: "networkidle", timeout: 30_000 });

  // ------------------------------------------------------------------
  // Wait for the Babylon canvas to paint a non-blank frame.
  //
  // Poll readPixels on a 10x10 grid until at least NON_BLANK_FRACTION_REQUIRED
  // of the sampled pixels differ from the known background color, or until
  // BLANK_TIMEOUT_MS elapses.
  // ------------------------------------------------------------------
  console.log("[screenshot] Waiting for canvas to paint...");

  const deadline = Date.now() + BLANK_TIMEOUT_MS;
  let painted = false;

  while (Date.now() < deadline) {
    const result = await page.evaluate(nonBlankCheckFn, {
      bgR: BG_R,
      bgG: BG_G,
      bgB: BG_B,
      bgTolerance: BG_TOLERANCE,
      sampleRows: SAMPLE_ROWS,
      sampleCols: SAMPLE_COLS,
    });

    if (result.error) {
      throw new Error(`Canvas check failed: ${result.error}`);
    }

    const pct = (result.fraction * 100).toFixed(1);
    if (result.fraction >= NON_BLANK_FRACTION_REQUIRED) {
      console.log(
        `[screenshot] Canvas is painted (${pct}% non-blank pixels via ${result.method}).`
      );
      painted = true;
      break;
    }

    console.log(
      `[screenshot] Canvas still blank (${pct}% non-blank via ${result.method}), retrying...`
    );
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  if (!painted) {
    throw new Error(
      `Canvas remained blank after ${BLANK_TIMEOUT_MS}ms.\n` +
        `  This likely means the scene failed to render (see issue #3 regression).\n` +
        `  Check the browser console, confirm the dev server is running, and verify\n` +
        `  the Babylon scene initializes correctly.`
    );
  }

  // ------------------------------------------------------------------
  // Export PNG from the canvas.
  //
  // Playwright's CDP-based element.screenshot() does not reliably read
  // back WebGL pixels in headless Chromium — it often produces a blank
  // black image.  Instead, call canvas.toDataURL() in-page, which reads
  // from the same retained draw buffer that readPixels uses.
  // (preserveDrawingBuffer:true is set in scene.js for exactly this reason.)
  // ------------------------------------------------------------------
  const dataUrl = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return null;
    // Force one final render tick before export so the frame is current
    return canvas.toDataURL("image/png");
  });

  if (!dataUrl || !dataUrl.startsWith("data:image/png;base64,")) {
    throw new Error(
      "canvas.toDataURL() returned an unexpected value.\n" +
        `  Got: ${String(dataUrl).slice(0, 80)}`
    );
  }

  const outDir = dirname(OUTPUT_PATH);
  mkdirSync(outDir, { recursive: true });

  const base64 = dataUrl.slice("data:image/png;base64,".length);
  const pngBuffer = Buffer.from(base64, "base64");
  writeFileSync(OUTPUT_PATH, pngBuffer);

  console.log(`[screenshot] Saved: ${OUTPUT_PATH}`);
  console.log(`[screenshot] Size : ${pngBuffer.length} bytes`);
}

// ---------------------------------------------------------------------------
// Entry point — always close browser in finally block
// ---------------------------------------------------------------------------
(async () => {
  try {
    await run();
  } catch (err) {
    // Set exit code rather than process.exit() so the finally block below
    // still runs and the browser is closed cleanly before the process ends.
    console.error(`[screenshot] FAILED: ${err.message}`);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
})();
