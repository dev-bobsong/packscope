---
title: DevTools Overrides
description: Use Chrome DevTools Local Overrides for the fastest edit-and-reload loop.
order: 4
---

For the fastest edit-and-reload loop inside a real browser, use Chrome DevTools **Local Overrides** together with the `--devtools` flag. Packscope mirrors the original site's URL paths (including the host) into `out/`, so Chrome swaps the responses in place — **no local server, no symlinks, single origin**.

## Setup

```bash
npx packscope --devtools https://example.com/assets/index-CLHtNMqj.js ./out
```

With `--devtools`, the unpacked files land at the same paths as the original URLs:

```
out/example.com/assets/index-CLHtNMqj.js   # Entry chunk
out/example.com/assets/<chunk>.js          # Each imported chunk
```

## Chrome Configuration

1. Open the page you want to debug (e.g. `https://example.com/chatPc`).
2. Open DevTools (`F12`) → **Sources** panel → left sidebar → **Overrides** tab.
3. Click **+ Select folder for overrides** and choose `./out` — the `out/` directory itself, **not** `out/example.com/`.
4. Click **Allow** in the permission prompt.
5. Enable the **Enable Local Overrides** checkbox.
6. Reload the page. Chrome now serves `https://example.com/assets/*` from `out/example.com/assets/*`.

See also: [Chrome DevTools Overrides documentation](https://developer.chrome.com/docs/devtools/overrides)

## Edit and Reload

### ES Module Bundles (Vite / rollup / esbuild)

Edit any file under `out/example.com/assets/` and reload the page — the change is live immediately, no rebuild needed. The ES module graph resolves imports natively in the browser.

### webpack / rspack Bundles

Edit `out/modules/<id>.js`, then regenerate the single bundle (written to the mirrored path) and reload:

```bash
node out/rebuild.js
```

## Why This Is the Recommended Browser Workflow

- **No local server.** Chrome serves the overridden files straight from disk. `packscope serve` is not needed for this workflow.
- **Single origin.** File paths match the original URLs exactly, so there is no mixed-content, no CORS, and no SSR hydration mismatch.
- **No parser-insertion race.** The swap happens at the network layer, so it works even for parser-inserted `<script type="module">` tags — unlike Tampermonkey-style DOM rewrites that can lose the race and load the original.

> **Note:** `packscope serve` is only relevant if you prefer a proxy-based workflow (whistle / mitmproxy) that maps the origin to `127.0.0.1:8765`. For most users, DevTools Overrides is simpler and more reliable.

## Troubleshooting

### "No overrides folder selected"

Make sure you selected `./out` (the parent directory), not `./out/example.com/`. Chrome expects the override root to contain host-named subdirectories.

### Changes not taking effect

1. Verify **Enable Local Overrides** is checked in the Overrides tab.
2. Check that the file path under `out/` exactly matches the URL path in the Network tab.
3. Hard-reload (`Cmd+Shift+R` / `Ctrl+Shift+R`) to bypass the browser cache.
