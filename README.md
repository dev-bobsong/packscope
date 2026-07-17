# Unpack — mono webpack/rspack or ES module bundle → human-readable & executable files

A small Node tool that takes a single ("mono") JavaScript bundle — webpack/rspack
script bundles **or** Vite/rollup/Angular-esbuild ES-module bundles — and unpacks it into:

- **One file per module** (`modules/<id>.js`) for webpack/rspack, or **one file per chunk** (`chunks/<name>.js`) for ES-module bundles.
- **A loader** (`runtime.js` + `index.js`) that reconstructs the original webpack/rspack bundle shape using the original UMD header and webpack runtime verbatim, so the unpacked tree **runs identically** to the original bundle.
- **A manifest** (`manifest.json`) with module/chunk IDs, sizes, dependency edges, and best-effort inferred names.
- **A rebuild script** (`rebuild.js`) that re-concatenates the (possibly edited) webpack/rspack module files back into a single runnable bundle.

## Install

```bash
npm install          # installs acorn + escodegen
```

## Usage

```bash
node unpack.js <bundle.js|URL> <outDir> [options]

# example (the codebuddy CLI bundle)
node unpack.js ./examples/codebuddy.js ./out

# example from a remote URL
node unpack.js https://static.thingsboard.cloud/main-FYV7DR6V.js ./out
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

## Output layout (`<outDir>/`)

### webpack/rspack bundles

```
header.js               # original UMD + bundle header, up to `{` of __webpack_modules__
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

### ES module bundles (Vite / rollup / Angular esbuild)

```
<entry>.js              # the entry chunk (e.g. main-FYV7DR6V.js), import specifiers rewritten locally
chunks/                 # all statically or dynamically imported JS chunks
sources/                # original source modules extracted from source maps (when available)
assets/                 # referenced source maps / asset URLs (when --fetch-assets is on)
index.html              # simple HTML page that loads the entry as a module
manifest.json           # bundle type, chunk graph, source list, asset list
package.json            # type: "module" for the unpacked tree
```

ES module bundles are already split into chunks by the bundler. Further splitting
into individual original modules requires source maps; when a chunk contains an
inline or external source map, the tool extracts each original source into
`sources/`. Production builds often omit source maps, so only chunk-level output
may be available.

## Unpacking from a URL

You can pass an `http://` or `https://` URL as the bundle argument. The file is
downloaded to a local cache directory (`.unpack-cache/`) and then unpacked as
usual:

```bash
# webpack/rspack bundle
node unpack.js https://example.com/app.js ./out

# ES module bundle (e.g. ThingsBoard / Angular esbuild)
node unpack.js https://static.thingsboard.cloud/main-FYV7DR6V.js ./out

# ES module bundle with pretty-printed chunks
node unpack.js https://static.thingsboard.cloud/main-FYV7DR6V.js ./out --beautify

# ES module bundle with best-effort per-class/per-module decomposition
node unpack.js https://static.thingsboard.cloud/main-FYV7DR6V.js ./out --decompose

# both
node unpack.js https://static.thingsboard.cloud/main-FYV7DR6V.js ./out --beautify --decompose
```

For ES module bundles, the tool automatically resolves and downloads all
statically and dynamically imported chunks from the same base URL, then rewrites
their import specifiers to local relative paths so the unpacked tree can be loaded
in a browser.

By default, referenced source maps and other asset URLs found inside the bundle
are also downloaded into `out/assets/`. Failures are logged but do not stop the
unpack. To skip passive asset downloads:

```bash
node unpack.js https://example.com/bundle.js ./out --no-fetch-assets
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

## Rebuild a single bundle (after editing modules/)

```bash
node out/rebuild.js codebuddy-edited.js
node codebuddy-edited.js --version
```

## How it works

1. Parse the bundle with **acorn**, locate `var __webpack_modules__ = { ... }`.
2. For each module, extract the original function body verbatim and write it as:
   ```js
   // webpack module <id>
   // params: eA, el, ec  (=> module, exports, require)
   module.exports = function(eA, el, ec) { <original body> };
   ```
   This guarantees the unpacked tree executes **exactly** like the original.
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
