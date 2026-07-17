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
