'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const PACKSCOPE = path.join(ROOT, 'packscope.js');
const EXAMPLES = path.join(ROOT, 'examples');
const OUT = path.join(ROOT, 'out', 'test');

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const cp = spawn(cmd, args, {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...opts,
    });
    let stdout = '';
    let stderr = '';
    cp.stdout.on('data', (d) => (stdout += d));
    cp.stderr.on('data', (d) => (stderr += d));
    cp.on('error', reject);
    cp.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function pack(bundleName, outName, extraArgs = []) {
  const outDir = path.join(OUT, outName);
  fs.rmSync(outDir, { recursive: true, force: true });
  return run('node', [PACKSCOPE, ...extraArgs, path.join(EXAMPLES, bundleName), outDir]);
}

function node(file) {
  return run('node', [file]);
}

function modulesDir(outName) {
  return path.join(OUT, outName, 'modules');
}

function outFile(outName, ...segments) {
  return path.join(OUT, outName, ...segments);
}

async function assertSuccess(res, message = '') {
  if (res.code !== 0) {
    throw new Error(
      `${message}\nexit code: ${res.code}\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`
    );
  }
}

describe('packscope CLI', () => {
  it('shows help when invoked with --help', async () => {
    const res = await run('node', [PACKSCOPE, '--help']);
    assert.equal(res.code, 0);
    assert.match(res.stdout, /Usage:/);
  });
});

describe('webpack bundles', () => {
  it('unpacks webpack-example.js and the loader runs correctly', async () => {
    const res = await pack('webpack-example.js', 'webpack');
    await assertSuccess(res, 'webpack-example unpack failed');
    assert.ok(fs.existsSync(modulesDir('webpack')));
    assert.ok(fs.existsSync(path.join(modulesDir('webpack'), '807.js')));
    assert.ok(fs.existsSync(path.join(modulesDir('webpack'), '853.js')));

    const runRes = await node(outFile('webpack', 'index.js'));
    await assertSuccess(runRes, 'webpack loader run failed');
    assert.match(runRes.stdout, /result:\s*5/);

    const rebuildRes = await node(outFile('webpack', 'rebuild.js'));
    await assertSuccess(rebuildRes, 'webpack rebuild failed');
    const bundleRes = await node(outFile('webpack', 'bundle-unpacked.js'));
    await assertSuccess(bundleRes, 'webpack rebuilt bundle run failed');
    assert.match(bundleRes.stdout, /result:\s*5/);
  });

  it('unpacks the large webpack example (node_large_example.js)', async () => {
    const res = await pack('node_large_example.js', 'large');
    await assertSuccess(res, 'node_large_example unpack failed');

    const manifest = JSON.parse(fs.readFileSync(outFile('large', 'manifest.json'), 'utf8'));
    assert.equal(manifest.moduleCount, 4339);
    assert.equal(manifest.entry, '29570');
    assert.deepEqual(manifest.externals, { '59547': 'chokidar' });

    const runRes = await run('node', [outFile('large', 'index.js'), '--version']);
    await assertSuccess(runRes, 'large loader run failed');
    assert.match(runRes.stdout, /2\.106\.4/);
  });
});

describe('rspack bundles', () => {
  it('unpacks rspack-example.js and the loader runs correctly', async () => {
    const res = await pack('rspack-example.js', 'rspack');
    await assertSuccess(res, 'rspack-example unpack failed');
    assert.ok(fs.existsSync(modulesDir('rspack')));

    const runRes = await node(outFile('rspack', 'index.js'));
    await assertSuccess(runRes, 'rspack loader run failed');
    assert.match(runRes.stdout, /result:\s*5/);

    const rebuildRes = await node(outFile('rspack', 'rebuild.js'));
    await assertSuccess(rebuildRes, 'rspack rebuild failed');
    const bundleRes = await node(outFile('rspack', 'bundle-unpacked.js'));
    await assertSuccess(bundleRes, 'rspack rebuilt bundle run failed');
    assert.match(bundleRes.stdout, /result:\s*5/);
  });
});

describe('ES module bundles', () => {
  for (const file of ['rollup-example.mjs', 'esbuild-example.mjs', 'vite-example.mjs', 'tsup-example.mjs']) {
    it(`unpacks ${file} and the entry still runs`, async () => {
      const name = file.replace(/\.mjs$/, '');
      const res = await pack(file, name);
      await assertSuccess(res, `${file} unpack failed`);

      const entry = path.join(OUT, name, file);
      assert.ok(fs.existsSync(entry), `entry ${entry} missing`);
      const runRes = await node(entry);
      await assertSuccess(runRes, `${file} entry run failed`);
      assert.match(runRes.stdout, /result:\s*5/);
    });
  }
});

describe('generic script bundles (non-webpack/rspack)', () => {
  for (const file of ['parcel-example.js', 'browserify-example.js']) {
    it(`keeps ${file} executable and produces a manifest`, async () => {
      const name = file.replace(/\.js$/, '');
      const res = await pack(file, name);
      await assertSuccess(res, `${file} unpack failed`);

      assert.ok(fs.existsSync(outFile(name, file)), `bundle copy missing for ${file}`);
      const manifest = JSON.parse(fs.readFileSync(outFile(name, 'manifest.json'), 'utf8'));
      assert.equal(manifest.bundleType, 'script');
      assert.equal(manifest.entry, file);

      const runRes = await node(outFile(name, 'index.js'));
      await assertSuccess(runRes, `${file} script bundle run failed`);
      assert.match(runRes.stdout, /result:\s*5/);
    });
  }
});

describe('optional flags', () => {
  it('supports --beautify and --rename on webpack bundles', async () => {
    const res = await pack('webpack-example.js', 'webpack-beauty', ['--beautify', '--rename']);
    await assertSuccess(res, 'webpack beautify/rename unpack failed');

    const runRes = await node(outFile('webpack-beauty', 'index.js'));
    await assertSuccess(runRes, 'webpack beautified loader run failed');
    assert.match(runRes.stdout, /result:\s*5/);
  });

  it('supports --decompose on ES module bundles', async () => {
    const res = await pack('rollup-example.mjs', 'rollup-decomp', ['--decompose']);
    await assertSuccess(res, 'rollup decompose unpack failed');

    const decomposedDir = outFile('rollup-decomp', 'decomposed');
    assert.ok(fs.existsSync(decomposedDir), 'decomposed dir missing');
    const units = fs.readdirSync(decomposedDir);
    assert.ok(units.length > 0, 'expected decomposed units');

    const runRes = await node(outFile('rollup-decomp', 'rollup-example.mjs'));
    await assertSuccess(runRes, 'rollup decomposed entry run failed');
    assert.match(runRes.stdout, /result:\s*5/);
  });
});

describe('mirror paths (--devtools)', () => {
  const { mirrorSubdir, allocateFile } = require('../packscope.js');

  it('mirrorSubdir / allocateFile include the host (DevTools Overrides layout)', () => {
    assert.equal(mirrorSubdir('https://example.com/assets/index-CLHtNMqj.js'), 'example.com/assets');
    assert.equal(mirrorSubdir('https://x.com/bundle.js'), 'x.com');
    assert.equal(mirrorSubdir('https://x.com/a/b/c.js'), 'x.com/a/b');

    const os = require('os');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'packscope-mirror-'));
    const chunksDir = path.join(tmp, 'chunks');
    const map = new Map();
    const entry = allocateFile('https://example.com/assets/index-CLHtNMqj.js', chunksDir, map, tmp);
    assert.equal(entry, path.join(tmp, 'example.com', 'assets', 'index-CLHtNMqj.js'));
    const chunk = allocateFile('https://example.com/assets/chunks/x.js', chunksDir, map, tmp);
    assert.equal(chunk, path.join(tmp, 'example.com', 'assets', 'chunks', 'x.js'));
    // non-mirror falls back to flat chunksDir + safe filename
    const map2 = new Map();
    const flat = allocateFile('https://example.com/assets/chunks/x.js', chunksDir, map2);
    assert.ok(flat.startsWith(chunksDir + path.sep), 'non-mirror should live under chunksDir');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('unpacks an ESM URL with --devtools mirroring the original path', async () => {
    const http = require('http');
    const server = http.createServer((req, res) => {
      const p = req.url.split('?')[0];
      const filePath = path.join(EXAMPLES, path.basename(p));
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('nf'); return; }
        res.writeHead(200, { 'Content-Type': 'text/javascript' });
        res.end(data);
      });
    });
    await new Promise((resolve) => server.listen(0, resolve));
    try {
      const host = `127.0.0.1:${server.address().port}`;
      const url = `http://${host}/assets/rollup-example.mjs`;
      const outName = 'esm-mirror';
      const outDir = outFile(outName);
      fs.rmSync(outDir, { recursive: true, force: true });
      const res = await run('node', [PACKSCOPE, '--devtools', url, outDir]);
      await assertSuccess(res, 'esm --devtools unpack failed');

      const mirroredEntry = outFile(outName, host, 'assets', 'rollup-example.mjs');
      assert.ok(fs.existsSync(mirroredEntry), `mirrored entry missing at out/${host}/assets/rollup-example.mjs`);
      assert.ok(!fs.existsSync(outFile(outName, 'rollup-example.mjs')), 'flat entry should NOT exist when mirroring');

      const manifest = JSON.parse(fs.readFileSync(outFile(outName, 'manifest.json'), 'utf8'));
      assert.equal(manifest.entry, `${host}/assets/rollup-example.mjs`);
      assert.equal(manifest.mirrored, true);
      assert.equal(manifest.urlBaseDir, `${host}/assets`);

      const runRes = await node(mirroredEntry);
      await assertSuccess(runRes, 'mirrored esm entry run failed');
      assert.match(runRes.stdout, /result:\s*5/);
    } finally {
      server.close();
    }
  });

  it('unpacks a local ESM file with --devtools but keeps flat layout', async () => {
    const res = await pack('rollup-example.mjs', 'esm-local-devtools', ['--devtools']);
    await assertSuccess(res, 'local esm --devtools unpack failed');
    // local file has no http(s) URL origin -> no mirroring
    assert.ok(fs.existsSync(outFile('esm-local-devtools', 'rollup-example.mjs')));
    const manifest = JSON.parse(fs.readFileSync(outFile('esm-local-devtools', 'manifest.json'), 'utf8'));
    assert.equal(manifest.mirrored, false);
  });
});

