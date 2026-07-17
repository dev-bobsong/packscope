# Example bundles

This directory contains representative JavaScript bundles produced by commonly
used bundlers. They are used by the test suite in `test/packscope.test.js`.

| File | Bundler | Format | Expected handling |
|------|---------|--------|-------------------|
| `webpack-example.js` | webpack 5 | CommonJS (node target) | webpack module-dict unpack |
| `rspack-example.js` | Rspack | CommonJS (node target) | webpack-compatible module-dict unpack |
| `rollup-example.mjs` | Rollup | ES module | ESM chunk unpack |
| `esbuild-example.mjs` | esbuild | ES module | ESM chunk unpack |
| `vite-example.mjs` | Vite 8 (Rollup) | ES module | ESM chunk unpack |
| `tsup-example.mjs` | tsup (esbuild) | ES module | ESM chunk unpack |
| `parcel-example.js` | Parcel 2 | CommonJS (scope-hoisted) | generic script fallback |
| `browserify-example.js` | Browserify | script bundle | generic script fallback |
| `node_large_example.js` | webpack 5 | production CLI bundle | large-scale webpack unpack |

## Regenerating the small examples

The source files live in `examples/src/`.

```bash
# webpack
npx --yes webpack-cli --mode production --target node --entry ./examples/src/main.cjs \
  --output-path examples --output-filename webpack-example.js \
  --output-library-type commonjs --output-library-name WebpackExample

# rspack
cat > examples/src/rspack.config.js <<'EOF'
const path = require('path');
module.exports = {
  mode: 'production', target: 'node',
  entry: path.resolve(__dirname, 'main.cjs'),
  output: { path: path.resolve(__dirname, '..'), filename: 'rspack-example.js',
            library: { type: 'commonjs', name: 'RspackExample' } }
};
EOF
npx --yes @rspack/cli --config examples/src/rspack.config.js

# ESM bundlers
npx --yes  rollup ./examples/src/main.js --format es --file examples/rollup-example.mjs
npx --yes  esbuild ./examples/src/main.js --bundle --format=esm --outfile=examples/esbuild-example.mjs
npx --yes  tsup ./examples/src/main.js --format esm --out-dir examples
mv examples/main.mjs examples/tsup-example.mjs
# Vite needs a local install, see examples/src/vite.config.mjs
```

The large example (`node_large_example.js`) is a real-world webpack production
bundle and should not be regenerated.
