# Unpack — mono webpack/rspack bundle → human-readable & executable files

A small Node tool that takes a single ("mono") webpack or rspack bundle and unpacks it into:

- **One file per module** (`modules/<id>.js`) — each wrapped as a standalone CommonJS module so you can read, navigate, and edit individual modules.
- **A loader** (`runtime.js` + `index.js`) that reconstructs the original bundle shape using the original UMD header and webpack runtime verbatim, so the unpacked tree **runs identically** to the original bundle.
- **A manifest** (`manifest.json`) with module IDs, sizes, dependency edges, and best-effort inferred names.
- **A rebuild script** (`rebuild.js`) that re-concatenates the (possibly edited) module files back into a single runnable bundle.

## Install

```bash
npm install          # installs acorn + escodegen
```

## Usage

```bash
node unpack.js <bundle.js> <outDir> [options]

# example (the codebuddy CLI bundle)
node unpack.js ./examples/codebuddy.js ./out
```

Options:
- `--beautify` — regenerate pretty (indented) module bodies via escodegen. **Best-effort** — for modules involved in fragile circular-dependency timings this can change statement order and break execution. Default OFF keeps the original source slices, which are guaranteed to run identically to the bundle.
- `--rename` — rename the 3 wrapper params to `module`/`exports`/`require` (opt-in, scope-aware; only applies when `--beautify` is on).
- `--entry <N>` — force entry module id (auto-detected otherwise).

## Output layout (`<outDir>/`)

```
header.js               # original UMD + bundle header, up to `{` of __webpack_modules__
webpack-runtime.js      # original webpack/rspack runtime + footer, from `}` onward
runtime.js              # loader: reconstructs the bundle with per-file module delegation
index.js                # shebang entry; wires externals, runs the entry module (the CLI)
modules/<id>.js         # one CommonJS file per webpack module (faithful original body)
manifest.json           # ids, sizes, dependencies, inferred names
rebuild.js              # regenerate a single runnable bundle from the module files
package.json            # makes <outDir> a self-contained node package
node_modules -> ...     # symlink to the source project's node_modules (best-effort)
```

## Run the unpacked bundle

```bash
node out/index.js --version     # should print the same version as the original
node out/index.js --help
node out/index.js --print "hello"
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
