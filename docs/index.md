---
title: Overview
description: Inspect, analyze, and debug JavaScript bundles from webpack, rspack, rollup, esbuild, and Vite.
order: 1
---

**Packscope** is a Node CLI that unpacks a single ("mono") JavaScript bundle into:

- **One file per module** (`modules/<id>.js`) for webpack/rspack, or **one file per chunk** (`chunks/<name>.js`) for ES-module bundles.
- **A loader** (`runtime.js` + `index.js`) that reconstructs the original bundle shape using the real UMD header and webpack runtime verbatim, so the unpacked tree **runs identically** to the original bundle.
- **A manifest** (`manifest.json`) with module/chunk IDs, sizes, dependency edges, and inferred names.
- **A rebuild script** (`rebuild.js`) that re-concatenates edited module files back into a single runnable bundle.

## Quick Start

```bash
# Clone and install
git clone https://github.com/awareride/packscope.git
cd packscope
npm install

# Unpack a local bundle
npx packscope ./dist/app.js ./out

# Or from a URL
npx packscope https://example.com/app.js ./out

# Run the unpacked tree
node out/index.js --version
```

## Supported Bundlers

Packscope handles the two major bundle families:

| Family | Bundlers | Output |
|--------|----------|--------|
| **webpack-style** | webpack, rspack | One file per module in `modules/<id>.js` |
| **ES module** | rollup, esbuild, Vite | One file per chunk in `chunks/<name>.js` |

## Why Packscope?

Production JavaScript bundles are opaque — a single 20 MB file with thousands of minified modules. Packscope gives you a navigable, editable, and **executable** project tree so you can:

- **Audit** what's actually shipped to users
- **Debug** production-only issues by editing modules and rebuilding
- **Learn** how popular CLI tools and libraries are structured
- **Patch** third-party bundles without access to the original source

## How It Works

1. **Parse** the bundle with [acorn](https://github.com/acornjs/acorn) and locate the webpack modules dictionary by shape — works even when identifiers are minified to single letters.
2. **Extract** each module's factory body verbatim. No AST rewrite means no statement-order surprises.
3. **Reconstruct** the loader: `header.js` + delegator-filled `__webpack_modules__` + original `webpack-runtime.js`. This reuses 100% of the original UMD + runtime.
4. **Wire externals** through the same UMD path as the original bundle.

## License

MIT — see [LICENSE](https://github.com/awareride/packscope/blob/main/LICENSE).
