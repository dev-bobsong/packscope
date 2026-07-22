---
title: Architecture
description: How Packscope unpacks bundles and reconstructs an executable module tree.
order: 5
---

This document describes how Packscope works under the hood. Understanding the architecture helps when debugging unpack issues or contributing to the project.

## Overview

Packscope takes a single JavaScript bundle file and produces a directory of individual module files that, when loaded through a reconstructed runtime, execute identically to the original.

The key insight is that **we don't reimplement the webpack runtime** — we reuse the original one verbatim.

## Detection: Finding the Modules Dictionary

Packscope parses the bundle with [acorn](https://github.com/acornjs/acorn) and locates the webpack modules dictionary by **shape**, not by name:

1. Find the webpack-style require function — the function that calls `<modules>[id].call(m, e, r)` or similar patterns.
2. Resolve the variable that holds the modules object (e.g., `__webpack_modules__`, or `t` when minified).
3. Walk the object expression to find all `{key: function(module, exports, require) { ... }}` entries.

This approach works regardless of how aggressively the bundle has been minified.

## Extraction: Faithful Body Slices

For each module, Packscope extracts the **original factory body verbatim** from the bundle source. The body is wrapped as:

```js
module.exports = function(eA, el, ec) { <original body> };
// or, when the original wrapper is an arrow function:
module.exports = (eA, el, ec) => { <original body> };
```

Preserving the original wrapper shape (function vs. arrow) keeps `this`-binding semantics identical.

### Why Not Beautify by Default?

We spent significant effort trying to make beautified/regenerated bodies the default (js-beautify, escodegen, AST-based rename). All approaches introduced subtle runtime regressions:

| Approach | Failure Mode |
|----------|-------------|
| `js-beautify` | Dropped a `var` keyword, creating a TDZ `ReferenceError` |
| `escodegen` | Shifted statement order relative to a circular dependency, causing `Cannot access 'x' before initialization` |
| AST rename (naive) | Shadowed a local `let el` with the param `el`, breaking readable-stream |

Production bundles have fragile circular-dependency timings and TDZ patterns. Any text/AST transformation that changes token positions or statement order risks breaking execution. The safe default is original slices.

## Reconstruction: The Loader

The loader (`runtime.js`) reconstructs the original bundle expression:

```
header.js  +  __webpack_modules__ = { <delegator props> }  +  webpack-runtime.js
```

Where:
- **`header.js`** — everything up to and including the opening `{` of the modules dictionary.
- **`webpack-runtime.js`** — everything from the closing `}` onward (original runtime, entry call, UMD footer).
- **Each `__webpack_modules__[id]`** is a thin delegator:
  ```js
  function(module, exports, req) {
    return loadFactory(id).call(this, module, exports, req);
  }
  ```

This reuses **100% of the original UMD + webpack runtime verbatim**, so externals and all runtime helpers (`.nmd`, `.d`, `.r`, `.t`, `.a`, `.n`) work as-is.

## Externals

Externals (like `chokidar`, `fs`, `path`) are detected from shim patterns in the bundle (e.g., `Cannot find module '<pkg>'`). They are wired through the same UMD factory path as the original bundle:

```js
typeof require === 'function' ? require('<pkg>') : ...
```

## ES Module Bundles

For rollup/esbuild/Vite bundles, Packscope:

1. Downloads the entry chunk (and all statically/dynamically imported chunks) from the same base URL.
2. Rewrites `import` specifiers to local relative paths.
3. Optionally extracts original sources from inline or external source maps into `sources/`.
4. Optionally decomposes chunks into top-level declarations (`--decompose`).

## The `node_modules` Symlink

Many bundles patch `globalThis.require = createRequire(__filename)`. In the unpacked tree, `__filename` points to `out/modules/<id>.js`, so `createRequire` resolves packages from `out/` instead of the original `dist/` directory.

Packscope creates a `node_modules` symlink in `out/` pointing to the source project's `node_modules` to give global `require('pkg')` calls a chance to resolve.

## Limitations

- **`--beautify` and `--rename` are best-effort.** Some modules with fragile circular dependencies or TDZ patterns may break when regenerated. Use them for reading, then fall back to original slices for execution.
- **The `node_modules` symlink** points to the source project's `node_modules`. If you move the unpacked tree elsewhere, global `require('pkg')` calls may fail unless you reinstall dependencies or fix the symlink.
- **`__filename`/`__dirname`** inside the bundle now see the unpacked file path instead of the original bundle path. The symlink mitigates this for package resolution but not for path-dependent logic.
