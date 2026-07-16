# Agent Work Log — Unpack

## Goal

Build a tool that unpacks a **mono webpack/rspack bundle** (single 21 MB file) into:
- **Human-readable** per-module files (beautified or at least isolated + documented)
- **Executable** — the unpacked tree must run identically to the original bundle

Sample target: `./examples/codebuddy.js` (4339 modules, entry `29570`, one external `chokidar`).

## What Exists Prior

- `split-codebuddy.js` in `dist/` — slices the bundle into raw minified fragments + header + runtime + manifest + rebuild script. **Not beautified, not individually executable.**
- Prior work in `dist/codebuddy-next/` already has 4340 raw fragment files. Our tool supersedes this with a proper executable loader.

## Architecture Decisions

### 1. Loader = reconstructed original bundle shape (most robust)

Instead of hand-rolling a `__webpack_require__` runtime (easy to miss helpers like `.nmd`, `.d`, `.r`, `.t`, `.a`, `.n`), the loader (`runtime.js`) literally reconstructs the original expression:

```
header.js  +  __webpack_modules__ = { <delegator props> }  +  webpack-runtime.js
```

- `header.js` — everything up to and including `var __webpack_modules__={`
- `webpack-runtime.js` — everything from the closing `}` onward (original runtime, entry call, UMD footer)
- Each `__webpack_modules__[id]` is a thin delegator: `function(module, exports, req) { return loadFactory(id).call(this, ...); }`

This reuses **100% of the original UMD + webpack runtime verbatim**, so externals and all runtime helpers work as-is.

### 2. Module files = `module.exports = function(eA, el, ec) { <original body> };`

**Default behavior** keeps the **original minified body slice** (byte-faithful). This guarantees the unpacked tree executes identically to the original.

We spent significant effort trying to make beautified/regenerated bodies the default (js-beautify, then escodegen, then AST-based rename). All of them introduced subtle runtime regressions:
- `js-beautify` dropped a `var` keyword in one module, creating a TDZ `ReferenceError`
- `escodegen` regenerated a module whose statement order shifted relative to a circular dependency, causing `Cannot access 'eI' before initialization`
- AST rename without block-scope tracking shadowed a local `let el` with the param `el`, turning `el.Readable.destroy` into `exports.Readable.destroy` and breaking readable-stream

**Conclusion:** production bundles have fragile circular-dependency timings and TDZ patterns. Any text/AST transformation that changes token positions or statement order risks breaking execution. The safe default is original slices.

### 3. Optional `--beautify` (escodegen) and `--rename` (scope-aware)

For users who want prettier code:
- `--beautify` uses `escodegen.generate()` for indented output
- `--rename` renames wrapper params `eA/el/ec` → `module/exports/require` via a **block/loop/function scope-aware analyzer** (handles `if`/`else`/`for`/`while`/`switch`/`try`/`catch`/`{}` shadowing correctly)

These are **best-effort** and documented as such.

### 4. `node_modules` symlink

The bundle patches `globalThis.require = createRequire(__filename)` (module `29570`). In the unpacked tree `__filename` points to `out/modules/29570.js` or `out/codebuddy-unpacked.js`, so `createRequire` resolves packages from `out/` instead of the original `dist/` directory. We create a `node_modules` symlink in `out/` pointing to the source project's `node_modules` to give global `require('pkg')` calls a chance to resolve.

## Verification

```bash
cd /path/to/packscope

# Clean unpack
node unpack.js ./examples/codebuddy.js ./out

# Per-module loader
node out/index.js --version        # → 2.106.4 ✅
node out/index.js --help           # → clean ✅
node out/index.js --print "hello"  # → response ✅

# Reconstructed single bundle
node out/rebuild.js codebuddy-unpacked.js
node out/codebuddy-unpacked.js --version   # → 2.106.4 ✅

# Edit → rebuild → run
echo "// patched" >> out/modules/92367.js
node out/rebuild.js codebuddy-patched.js
node out/codebuddy-patched.js --version    # → 2.106.4 ✅
```

## Output Structure

```
out/
  header.js              # UMD header up to `{` of __webpack_modules__
  webpack-runtime.js     # original runtime + footer from `}` onward
  runtime.js             # loader (reconstructed bundle with delegators)
  index.js               # shebang entry; runs the loader
  modules/<id>.js        # one CommonJS file per module (faithful body)
  manifest.json          # ids, sizes, deps, inferred names
  rebuild.js             # reassemble into single runnable bundle
  package.json           # self-contained node package metadata
  node_modules -> ...    # symlink to source project's node_modules
```

## Known Limitations

- `--beautify` / `--rename` are best-effort. Some modules with fragile circular dependencies or TDZ patterns may break when regenerated; use them for reading, then fall back to original slices for execution.
- The `node_modules` symlink points to the **source project's** `node_modules`. If you move the unpacked tree elsewhere, global `require('pkg')` calls may fail unless you reinstall dependencies or fix the symlink.
- Modules that rely on `__filename`/`__dirname` inside the bundle (e.g. `createRequire(__filename)`) now see the unpacked file path instead of the original bundle path. The symlink mitigates this for package resolution but not for path-dependent logic.
