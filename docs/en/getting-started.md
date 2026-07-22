---
title: Getting Started
description: Install Packscope and unpack your first bundle.
order: 2
---

This guide walks you through installing Packscope and unpacking your first JavaScript bundle.

## Prerequisites

- **Node.js** >= 14.0.0

## Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/awareride/packscope.git
cd packscope
npm install
```

Packscope has three dependencies:

| Package | Purpose |
|---------|---------|
| [acorn](https://github.com/acornjs/acorn) | Parse the bundle AST to locate module boundaries |
| [escodegen](https://github.com/estools/escodegen) | Regenerate code when `--beautify` is used |
| [js-beautify](https://github.com/beautifier/js-beautify) | Pretty-print ES module chunks when `--beautify` is used |

## Your First Unpack

### Local Bundle File

```bash
npx packscope ./dist/app.js ./out
```

### From a Remote URL

```bash
npx packscope https://example.com/main-ABCD1234.js ./out
```

For ES module bundles, Packscope automatically resolves and downloads all statically and dynamically imported chunks from the same base URL, then rewrites import specifiers to local relative paths.

## Output Layout

### webpack / rspack Bundles

```
out/
├── header.js            # Original UMD header, up to the opening `{` of modules
├── webpack-runtime.js   # Original runtime + footer from `}` onward
├── runtime.js           # Loader: reconstructs the bundle with per-file delegation
├── index.js             # Shebang entry; runs the entry module
├── modules/
│   ├── 123.js           # One CommonJS file per webpack module
│   ├── 456.js
│   └── ...
├── assets/              # Downloaded source maps and assets (with --fetch-assets)
├── manifest.json        # IDs, sizes, dependencies, inferred names
├── rebuild.js           # Reassemble into a single runnable bundle
├── package.json         # Self-contained node package metadata
└── node_modules -> ...  # Symlink to source project's node_modules
```

### ES Module Bundles (rollup / esbuild / Vite)

```
out/
├── <entry>.js           # Entry chunk with rewritten local imports
├── chunks/              # All statically and dynamically imported chunks
├── sources/             # Original source modules from source maps
├── decomposed/          # Best-effort class/module extracts (with --decompose)
├── assets/              # Downloaded source maps and assets
├── index.html           # Simple HTML page to load the entry as a module
├── manifest.json        # Bundle type, chunk graph, source list
└── package.json         # type: "module" for the unpacked tree
```

## Running the Unpacked Tree

### webpack / rspack Output

```bash
node out/index.js --version
# Should print the same version as the original bundle

node out/index.js --help
```

### ES Module Output

Serve with any static HTTP server:

```bash
cd out && python3 -m http.server 8080
# Open http://localhost:8080/index.html
```

## Next Steps

- Read the [CLI Reference](./cli-reference.md) for all available options
- Learn about [DevTools Overrides](./devtools-overrides.md) for browser debugging
- Check out the [Architecture](./architecture.md) to understand how Packscope works under the hood
