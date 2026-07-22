<p align="center">
  <img src="./icon.svg" alt="Packscope" width="120" height="120">
</p>

# Packscope — inspect, analyze, and debug JavaScript bundles

A small Node CLI that unpacks a single ("mono") JavaScript bundle — from
**webpack**, **rspack**, **rollup**, **esbuild**, or **Vite** — into:

- **One file per module** (`modules/<id>.js`) for webpack/rspack, or **one file per chunk** (`chunks/<name>.js`) for ES-module bundles.
- **A loader** (`runtime.js` + `index.js`) that reconstructs the original webpack/rspack bundle shape using the original UMD header and webpack runtime verbatim, so the unpacked tree **runs identically** to the original bundle.
- **A manifest** (`manifest.json`) with module/chunk IDs, sizes, dependency edges, and best-effort inferred names.
- **A rebuild script** (`rebuild.js`) that re-concatenates the (possibly edited) webpack/rspack module files back into a single runnable bundle.

📖 **Full documentation:** [open.awareride.com/packscope/docs](https://open.awareride.com/packscope/docs/)

## Install

```bash
git clone https://github.com/awareride/packscope.git
cd packscope
npm install          # installs acorn + escodegen + js-beautify
```

## Usage

```bash
npx packscope <bundle.js|URL> <outDir> [options]

# example (local webpack/rspack CLI bundle)
npx packscope ./examples/node_large_example.js ./out

# example from a remote URL
npx packscope https://example.com/app.js ./out
```

Options:
- `--beautify` — pretty-print the output.
  - For **webpack/rspack** modules: regenerates module bodies via escodegen. **Best-effort** — for modules involved in fragile circular-dependency timings this can change statement order and break execution.
  - For **ES module** chunks: pretty-prints the entry and each downloaded chunk with `js-beautify`.
  Default OFF keeps the original source slices, which are guaranteed to run identically to the bundle.
- `--decompose` — for ES module bundles, extract top-level classes, services, functions, and CommonJS-style module wrappers into a read-only `decomposed/` tree for navigation. Not executable; best-effort.
- `--rename` — rename the 3 wrapper params to `module`/`exports`/`require` (opt-in, scope-aware; only applies when `--beautify` is on for webpack/rspack).
- `--fetch-assets` — auto-download referenced source maps and other asset URLs found in the bundle (default ON for URL inputs, OFF for local file inputs).
- `--no-fetch-assets` — skip downloading referenced assets.
- `--entry <N>` — force entry module id (auto-detected otherwise).
- `--devtools` — mirror the original site's URL paths into `<outDir>` (e.g.
  `out/<host>/assets/index-*.js` instead of `out/index-*.js`). Chrome DevTools
  Local Overrides stores files at `<folder>/<host>/<path>`, so this keeps the local
  layout identical to the remote and lets you override the original URLs with zero
  symlinks and a single origin (no mixed-content / CORS / SSR hydration mismatch,
  and no parser-insertion race that breaks Tampermonkey-style DOM rewrites). For
  ESM bundles the entry and chunks keep their relative import structure; for
  webpack/rspack the rebuilt single bundle is written at the mirrored path.

## Output layout (`<outDir>/`)

### webpack/rspack bundles

```
header.js               # original UMD + bundle header, up to `{` of the modules dictionary
webpack-runtime.js      # original webpack/rspack runtime + footer, from `}` onward
runtime.js              # loader: reconstructs the bundle with per-file module delegation
index.js                # shebang entry; wires externals, runs the entry module (the CLI)
modules/<id>.js         # one CommonJS file per webpack module (faithful original body)
assets/                 # referenced source maps / asset URLs (when --fetch-assets is on)
manifest.json           # ids, sizes, dependencies, inferred names, asset list
rebuild.js              # regenerate a single runnable bundle from the module files
package.json            # makes <outDir> a self-contained node package
node_modules -> ...     # symlink to the source project's node_modules (best-effort)
```

### ES module bundles (rollup / esbuild / Vite)

```
<entry>.js              # the entry chunk, import specifiers rewritten locally
chunks/                 # all statically or dynamically imported JS chunks
sources/                # original source modules extracted from source maps (when available)
decomposed/             # best-effort class/module extracts for reading/navigation (with --decompose)
assets/                 # referenced source maps / asset URLs (when --fetch-assets is on)
index.html              # simple HTML page that loads the entry as a module
manifest.json           # bundle type, chunk graph, source list, asset list
package.json            # type: "module" for the unpacked tree
```

ES module bundles are already split into chunks by the bundler. Further splitting
into individual original modules requires source maps; when a chunk contains an
inline or external source map, the tool extracts each original source into
`sources/`.

Production builds often omit source maps. In that case you can use `--decompose`
to get a read-only, best-effort decomposition of each chunk into top-level
classes, services, functions, and CommonJS-style module wrappers. The files in
`decomposed/` are NOT executable — they are for navigation and grep/inspection
only.

## Unpacking from a URL

You can pass an `http://` or `https://` URL as the bundle argument. The file is
downloaded to a local cache directory (`.packscope-cache/`) and then unpacked as
usual:

```bash
# webpack/rspack bundle
npx packscope https://example.com/app.js ./out

# ES module bundle (rollup / esbuild / Vite)
npx packscope https://example.com/main-ABCD1234.js ./out

# ES module bundle with pretty-printed chunks
npx packscope https://example.com/main-ABCD1234.js ./out --beautify

# ES module bundle with best-effort per-class/per-module decomposition
npx packscope https://example.com/main-ABCD1234.js ./out --decompose

# both
npx packscope https://example.com/main-ABCD1234.js ./out --beautify --decompose
```

For ES module bundles, the tool automatically resolves and downloads all
statically and dynamically imported chunks from the same base URL, then rewrites
their import specifiers to local relative paths so the unpacked tree can be loaded
in a browser.

By default, referenced source maps and other asset URLs found inside the bundle
are also downloaded into `out/assets/`. Failures are logged but do not stop the
unpack. To skip passive asset downloads:

```bash
npx packscope https://example.com/bundle.js ./out --no-fetch-assets
```

Chunk downloads for ES module bundles happen regardless of `--fetch-assets`,
because the chunks are part of the executable module graph.

## Run the unpacked bundle

### webpack/rspack output

```bash
node out/index.js --version     # should print the same version as the original
node out/index.js --help
node out/index.js --print "hello"
```

### ES module output

The unpacked ES module tree can be served by any static HTTP server and opened
in a browser:

```bash
cd out && python3 -m http.server 8080
# open http://localhost:8080/index.html
```

## Browser dev workflow with DevTools Overrides

For the fastest edit-and-reload loop inside a real browser, use Chrome DevTools
**Local Overrides** together with the `--devtools` flag. packscope mirrors the
original site's URL paths (including the host) into `out/`, so Chrome swaps the
responses in place — **no local server, no symlinks, single origin**.

```bash
npx packscope --devtools https://example.com/assets/index-CLHtNMqj.js ./out
```

With `--devtools`, the unpacked files land at the same paths as the original
URLs, e.g.:

```
out/example.com/assets/index-CLHtNMqj.js   # entry (was /assets/index-*.js on the site)
out/example.com/assets/<chunk>.js           # each imported chunk
```

Then in Chrome:

1. Open the page you want to debug (e.g. `https://example.com/chatPc`).
2. Open DevTools (F12) → **Sources** panel → left sidebar → **Overrides**.
3. Click **+ Select folder for overrides** and choose `./out` — the `out/`
   directory itself, **not** `out/example.com/`.
4. Click **Allow**, then enable **Enable Local Overrides**.
5. Reload the page. Chrome now serves `https://example.com/assets/*` from
   `out/example.com/assets/*`.

See Google's guide: <https://developer.chrome.com/docs/devtools/overrides>

### Edit and reload

- **ES module bundles** (Vite / rollup / esbuild): edit any file under
  `out/example.com/assets/` and reload — the change is live, no rebuild needed.
- **webpack / rspack bundles**: edit `out/modules/<id>.js`, then regenerate the
  single bundle (written to the mirrored path) and reload:

  ```bash
  node out/rebuild.js
  ```

### Why this is the recommended browser workflow

- **No local server.** Chrome serves the overridden files straight from disk,
  so `packscope serve` is not needed for this workflow.
- **Single origin.** The file paths match the original URLs, so there is no
  mixed-content, no CORS, and no SSR hydration mismatch.
- **No parser-insertion race.** The swap happens at the network layer, so it
  works even for parser-inserted `<script type="module">` tags (where a
  Tampermonkey-style DOM rewrite would lose the race and load the original).

> Note: `packscope serve` only matters if you instead prefer a proxy
> (whistle / mitmproxy) that maps the origin to `127.0.0.1:8765`.

## Rebuild a single bundle (after editing modules/)

```bash
node out/rebuild.js bundle-edited.js
node bundle-edited.js --version
```

## How it works

1. Parse the bundle with **acorn** and locate the webpack modules dictionary. It is found by shape: the tool identifies the webpack-style require function (the one that calls `<modules>[id].call(...)`) and then resolves the variable that holds the modules object. This works even when `__webpack_modules__` and `__webpack_require__` have been minified to single-letter identifiers.
2. For each module, extract the original factory body verbatim and write it as:
   ```js
   // webpack module <id>
   // params: eA, el, ec  (=> module, exports, require)
   module.exports = function(eA, el, ec) { <original body> };
   // or, when the original wrapper is an arrow function:
   module.exports = (eA, el, ec) => { <original body> };
   ```
   Preserving the original wrapper shape (function vs. arrow) keeps the `this`-binding semantics identical, so the unpacked tree executes **exactly** like the original.
3. The loader (`runtime.js`) rebuilds the original bundle expression:
   `header.js` + `__webpack_modules__ = { <delegator props> }` + `webpack-runtime.js`.
   Each `__webpack_modules__[id]` is a tiny delegator that `require`s the corresponding
   `modules/<id>.js` and calls its factory with the original `module`/`exports`/`require`.
4. Externals (e.g. `chokidar`) are detected from the `Cannot find module '<pkg>'` shim and
   wired in via the UMD header (same as the original).

## Why default to original (minified) slices?

Production webpack bundles often contain fragile circular-dependency timings and
`let`/`const` TDZ patterns that are extremely sensitive to exact statement order.
Even AST-faithful code generators like **escodegen** can subtly shift the relative
position of variable initializations and `require()` calls, which causes runtime errors
that the original bundle does not have.

For that reason the **default** output keeps the original minified body slices — they
are still in separate, navigable files with documented param mappings, and they are
**guaranteed executable**. Use `--beautify` when you want prettier code for reading,
but be aware it is best-effort.

## Documentation

Full documentation is available at **[open.awareride.com/packscope/docs](https://open.awareride.com/packscope/docs/)**.

| Page | Description |
|------|-------------|
| [Overview](https://open.awareride.com/packscope/docs/) | What Packscope does and why |
| [Getting Started](https://open.awareride.com/packscope/docs/getting-started/) | Installation and first unpack |
| [CLI Reference](https://open.awareride.com/packscope/docs/cli-reference/) | All options and examples |
| [DevTools Overrides](https://open.awareride.com/packscope/docs/devtools-overrides/) | Chrome DevTools workflow |
| [Architecture](https://open.awareride.com/packscope/docs/architecture/) | How Packscope works under the hood |

Documentation source lives in [`docs/packscope/`](./docs/packscope/) - English pages in `en/` (the default locale and source of truth) plus Chinese translations in `zh/` - and is synced to the central hub on every push to `main`.

## License

MIT — see [LICENSE](./LICENSE).

