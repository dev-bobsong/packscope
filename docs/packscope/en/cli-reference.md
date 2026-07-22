---
title: CLI Reference
description: Complete reference for the Packscope command-line interface.
order: 3
---

## Syntax

```bash
npx packscope <bundle.js|URL> <outDir> [options]
```

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `<bundle>` | Yes | Path to a local `.js` bundle file, or an `http://` / `https://` URL |
| `<outDir>` | Yes | Directory where the unpacked tree will be written |

## Options

### `--beautify`

Pretty-print the output.

- **webpack/rspack**: Regenerates module bodies via [escodegen](https://github.com/estools/escodegen). **Best-effort** — for modules involved in fragile circular-dependency timings, this can change statement order and break execution.
- **ES module bundles**: Pretty-prints each chunk with [js-beautify](https://github.com/beautifier/js-beautify).

Default: **OFF**. The default keeps original source slices, which are guaranteed to run identically.

### `--rename`

Rename the 3 wrapper parameters to `module`, `exports`, and `require`.

Only applies when `--beautify` is enabled for webpack/rspack bundles. Uses a block/loop/function scope-aware analyzer that correctly handles `if`/`else`/`for`/`while`/`switch`/`try`/`catch`/`{}` shadowing.

### `--decompose`

For ES module bundles: extract top-level classes, services, functions, and CommonJS-style module wrappers into a read-only `decomposed/` tree.

The files in `decomposed/` are **not executable** — they are for navigation and grep/inspection only.

### `--fetch-assets` / `--no-fetch-assets`

Control whether referenced source maps and other asset URLs are downloaded.

| Input type | Default |
|------------|---------|
| Local file | `--no-fetch-assets` |
| URL | `--fetch-assets` |

Failures during asset download are logged but do not stop the unpack.

### `--entry <N>`

Force a specific entry module ID. By default, Packscope auto-detects the entry by analyzing the webpack runtime's entry call.

### `--devtools`

Mirror the original site's URL paths into `<outDir>` for use with Chrome DevTools **Local Overrides**.

```bash
npx packscope --devtools https://example.com/assets/index-CLHtNMqj.js ./out
```

This produces:

```
out/example.com/assets/index-CLHtNMqj.js
out/example.com/assets/<chunk>.js
```

See the [DevTools Overrides](/packscope/docs/devtools-overrides/) guide for setup instructions.

## Examples

### Basic Unpack (Local)

```bash
npx packscope ./examples/node_large_example.js ./out
```

### Unpack from URL with Beautify

```bash
npx packscope https://example.com/app.js ./out --beautify
```

### ES Module Bundle with Decomposition

```bash
npx packscope https://example.com/main-ABCD1234.js ./out --decompose
```

### DevTools Overrides Mode

```bash
npx packscope --devtools https://example.com/assets/index-CLHtNMqj.js ./out
```

### Edit and Rebuild

```bash
# Unpack
npx packscope ./dist/app.js ./out

# Edit a module
echo "// patched" >> out/modules/92367.js

# Rebuild into a single bundle
node out/rebuild.js bundle-patched.js

# Run the patched bundle
node bundle-patched.js --version
```
