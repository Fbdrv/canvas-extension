# Canvas Modules Presentation Downloader

A Firefox/Zen WebExtension that, on Canvas **Modules** pages, shows a compact overlay in the top-right listing presentation files (PDFs, PowerPoints, etc.) with checkboxes, a **Select all** toggle, and a **Download selected** button.

## Features

- Detects likely presentation/file links on Canvas course Modules pages — including `/modules/items/<id>` links that don't contain a file extension.
- Automatically resolves Canvas module-item pages to the underlying `/files/<id>?download=1` URL before downloading.
- Keyboard shortcut (default **Alt+Shift+P** / **Option+Shift+P** on macOS) to toggle the overlay.
- Per-file checkboxes, **Select all**, and a clear download call-to-action.
- Uses your existing Canvas login session — no API token required.
- Debug feedback: when no files are detected, the overlay shows scan statistics and a **Copy debug info** button so you can quickly diagnose issues.

## Project layout

- `manifest.json` – WebExtension manifest (Manifest V2, Firefox/Zen target).
- `src/background/service_worker.js` – Background script handling commands, module-item URL resolution, and download queue.
- `src/content/canvas_modules_parser.js` – Heuristic parser for Canvas Modules DOM to find file links (direct `/files/` links and `/modules/items/` links).
- `src/content/overlay.js` – Overlay UI logic (rendering, debug block, interactions).
- `src/content/content.js` – Glue code: handles messages, keyboard shortcut, and talking to background.
- `src/content/overlay.css` – Styles for the overlay (namespaced with `cpd-` classes).

No build tooling is required; the extension loads directly from these source files.

## Loading in Firefox / Zen Browser

1. Open **Firefox** or **Zen Browser**.
2. Navigate to `about:debugging`.
3. Choose **This Firefox** (or the equivalent section in Zen).
4. Click **Load Temporary Add-on**.
5. Select the `manifest.json` file from this project directory.
6. Open a Canvas course **Modules** page.
7. Press **Alt+Shift+P** (or **Option+Shift+P** on macOS), or configure the extension shortcut in the add-ons UI.

The overlay should appear in the top-right, showing all detected files with checkboxes and a **Download selected** button.

## Debugging / Development workflow

### Inspecting logs

- **Background script console**: Go to `about:debugging` → This Firefox → find the extension → click **Inspect**. This opens a devtools window for the background script — you'll see `[CPD bg]` prefixed log messages here.
- **Content script console**: On the Canvas page, open the browser devtools (F12 or Cmd+Option+I). Content script logs are prefixed with `[CPD]` and appear in the normal page console.

### Faster iteration with `web-ext` (optional)

Mozilla's [`web-ext`](https://github.com/nicerobot/nicerobot.github.io/wiki/web-ext) tool can auto-reload the extension on file changes:

```bash
npx web-ext run --source-dir . --firefox /path/to/firefox
```

If Zen doesn't support `web-ext` directly, develop against Firefox Developer Edition and load the same build in Zen for final verification.

### When no files are detected

If the overlay says "No presentation files detected", click **Copy debug info** to copy a JSON blob with:
- The current page URL
- Total anchors scanned
- Matched anchors count
- Sample hrefs found on the page

Paste that info when reporting issues so we can quickly tune the parser heuristics.
