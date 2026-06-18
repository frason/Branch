# Branch Client

React + Vite + Babylon.js canvas application.

## Development

```bash
npm install
npm run dev        # starts Vite dev server at http://localhost:5173
npm run build      # production build → dist/
npm test           # vitest unit tests
```

## Headless Screenshot

Captures the live Babylon.js canvas to a PNG for visual verification.

**Prerequisites:**
- `npm install` has been run.
- The Playwright Chromium browser is installed (one-time): `npx playwright install chromium`.
  `npm install` alone does **not** download the browser binary, so this step is required
  before the first run.
- A dev server (or any server) is already running — the script does not spawn one.

```bash
# 1. One-time: install the headless browser
npx playwright install chromium

# 2. Start the dev server (in one terminal or backgrounded):
npm run dev

# 3. Run the screenshot tool (in another terminal):
npm run screenshot
```

Output lands at `docs/screenshots/canvas.png` relative to the repo root.
A relative `--out=` path is resolved from the directory you run the command in
(not the repo root).

### Custom URL / output path

```bash
npm run screenshot -- --url=http://localhost:5173 --out=/tmp/my-canvas.png
```

### Blank-canvas anti-regression guard

The script polls the WebGL canvas pixels after page load. If the canvas
remains blank (all sampled pixels match the dark `#0d0d0d` background) for
more than 10 seconds, it **exits with code 1** and prints a clear error.

This catches the class of regression shipped in issue #3, where a material
configuration change made the node invisible and unit tests could not detect
it. A blank canvas is always a hard failure.

### How non-blank detection works

1. After `networkidle`, the script enters a polling loop (every 300 ms, up to 10 s).
2. Each iteration evaluates in-page JS that calls `gl.readPixels` on a 10x10
   grid (100 sample points) spread across the canvas.
3. A pixel is "non-blank" if its Manhattan distance from the background color
   `(13, 13, 13)` exceeds a tolerance of 15.
4. If at least 3% of sampled pixels (≥ 3 of 100) are non-blank, the canvas is
   considered painted and the script proceeds to capture the PNG. Requiring
   more than a single stray pixel keeps a broken render from sneaking through.
   This threshold is calibrated to the current single-node layout — revisit it
   as the scene grows (multi-node, edges, panels).
5. Falls back to a 2D canvas draw + `getImageData` readback if a WebGL context
   is not available.

### Playwright browser

Chromium is installed outside the repo under `~/.cache/ms-playwright` via:

```bash
npx playwright install chromium
```

Nothing from that installation is committed to git.
