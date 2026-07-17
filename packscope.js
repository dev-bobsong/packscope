#!/usr/bin/env node
'use strict';

/**
 * packscope.js — inspect, analyze, and debug JavaScript bundles from
 * webpack/rspack/rollup/esbuild/Vite by unpacking them into human-readable,
 * individually-executable modules plus a loader.
 *
 * Usage: npx packscope <bundle.js|URL> <outDir> [options]
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL, fileURLToPath, pathToFileURL } = require('url');
const acorn = require('acorn');
const escodegen = require('escodegen');
const jsBeautify = require('js-beautify').js_beautify;

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------
function isUrl(str) {
  return /^https?:\/\//i.test(str);
}

function detectBundleType(source) {
  // webpack/rspack mono bundles are scripts with the module dictionary.
  if (source.includes('var __webpack_modules__') || source.includes('__webpack_require__')) {
    return 'webpack';
  }
  // Vite/rollup/Angular-esbuild outputs are ES modules with import/export.
  if (/^\s*(import|export)\b/m.test(source)) {
    return 'esm';
  }
  return 'webpack'; // fallback; will likely fail parse if truly ESM
}

function urlBasename(url) {
  const p = new URL(url).pathname;
  const base = path.basename(p) || 'bundle.js';
  return base.split(/[?#]/)[0];
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function getCacheDir() {
  const dir = path.resolve('.packscope-cache');
  ensureDir(dir);
  return dir;
}

function fetchUrl(url, options = {}) {
  const retries = options.retries ?? 3;
  const delay = options.retryDelay ?? 500;
  return new Promise((resolve, reject) => {
    function attempt(remaining) {
      const urlObj = new URL(url);
      const client = urlObj.protocol === 'https:' ? https : http;
      const req = client.get(url, { headers: options.headers }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          const loc = res.headers.location;
          if (!loc) return reject(new Error(`Redirect with no Location for ${url}`));
          return resolve(fetchUrl(new URL(loc, url).toString(), options));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({
          url,
          statusCode: res.statusCode,
          headers: res.headers,
          data: Buffer.concat(chunks),
        }));
      });
      req.on('error', (err) => {
        if (remaining > 0) {
          console.warn(`[packscope] retry ${url} (${remaining} left): ${err.message}`);
          setTimeout(() => attempt(remaining - 1), delay);
        } else {
          reject(err);
        }
      });
      req.setTimeout(options.timeout || 60000, () => {
        req.destroy();
        const err = new Error(`Timeout fetching ${url}`);
        if (remaining > 0) {
          console.warn(`[packscope] retry ${url} (${remaining} left): ${err.message}`);
          setTimeout(() => attempt(remaining - 1), delay);
        } else {
          reject(err);
        }
      });
    }
    attempt(retries);
  });
}

async function downloadUrl(url, destPath, options = {}) {
  ensureDir(path.dirname(destPath));
  let data;
  let contentType;
  if (url.startsWith('file:')) {
    const filePath = fileURLToPath(url);
    data = fs.readFileSync(filePath);
  } else {
    const res = await fetchUrl(url, options);
    data = res.data;
    contentType = res.headers['content-type'];
  }
  fs.writeFileSync(destPath, data);
  return { url, path: destPath, size: data.length, contentType };
}

// ---------------------------------------------------------------------------
// Options / CLI
// ---------------------------------------------------------------------------
const POS_NAMES = ['module', 'exports', 'require'];

function parseArgs(argv) {
  const args = {
    bundle: null,
    out: null,
    rename: false,
    beautify: false,
    entry: null,
    help: false,
    fetchAssets: null, // null = auto (true for URLs, false for local files)
  };
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-rename') args.rename = false;
    else if (a === '--rename') args.rename = true;
    else if (a === '--no-beautify') args.beautify = false;
    else if (a === '--beautify') args.beautify = true;
    else if (a === '--decompose') args.decompose = true;
    else if (a === '--fetch-assets') args.fetchAssets = true;
    else if (a === '--no-fetch-assets') args.fetchAssets = false;
    else if (a === '--entry') args.entry = argv[++i];
    else if (a === '-h' || a === '--help') args.help = true;
    else positionals.push(a);
  }
  if (positionals[0]) args.bundle = positionals[0];
  if (positionals[1]) args.out = positionals[1];
  return args;
}

const HELP = `
packscope — inspect, analyze, and debug JavaScript bundles from webpack, rspack,
rollup, esbuild, and Vite.

Usage:
  npx packscope <bundle.js|URL> <outDir> [options]

The bundle argument may be a local file path or an http(s) URL. URLs are downloaded
into a local cache before unpacking.

Bundle type is auto-detected: webpack/rspack script bundles are reconstructed with
per-module delegators; ES module bundles have their imported chunks resolved and
downloaded recursively.

Options:
  --no-rename        keep obfuscated wrapper params (eA, el, ec) [DEFAULT]
  --rename           rename wrapper params to module/exports/require (opt-in, scope-aware)
  --beautify         regenerate pretty (indented) module bodies via escodegen
                    [best-effort; default OFF keeps the original source slices, which are
                     guaranteed to run identically to the bundle]
  --decompose        for ES module bundles, also extract top-level classes / modules
                    into a read-only decomposed/ view (best-effort)
  --fetch-assets     auto-download referenced source maps / asset URLs
  --no-fetch-assets  don't auto-download referenced assets
  --entry <N>        force entry module id (auto-detected otherwise)
  -h, --help         show this help
`;

// ---------------------------------------------------------------------------
// Beautify options
// ---------------------------------------------------------------------------
const BEAUTIFY_OPTS = {
  indent_size: 2,
  indent_char: ' ',
  space_in_empty_paren: true,
  preserve_newlines: false,
  max_preserve_newlines: 0,
  wrap_line_length: 0,
  end_with_newline: true,
  brace_style: 'collapse',
  unescape_strings: false,
  keep_array_indentation: false,
};

// ---------------------------------------------------------------------------
// AST helpers
// ---------------------------------------------------------------------------
function findWebpackModulesNode(node) {
  if (!node || typeof node !== 'object') return null;
  if (
    node.type === 'VariableDeclarator' &&
    node.id &&
    node.id.type === 'Identifier' &&
    node.id.name === '__webpack_modules__'
  ) {
    return node;
  }
  for (const key of Object.keys(node)) {
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        const found = findWebpackModulesNode(item);
        if (found) return found;
      }
    } else if (child && typeof child === 'object' && child.type) {
      const found = findWebpackModulesNode(child);
      if (found) return found;
    }
  }
  return null;
}

function collectPatternBindings(pattern, out) {
  if (!pattern) return;
  switch (pattern.type) {
    case 'Identifier':
      out.push(pattern);
      break;
    case 'AssignmentPattern':
      collectPatternBindings(pattern.left, out);
      break;
    case 'RestElement':
      collectPatternBindings(pattern.argument, out);
      break;
    case 'ArrayPattern':
      for (const el of pattern.elements) collectPatternBindings(el, out);
      break;
    case 'ObjectPattern':
      for (const prop of pattern.properties) {
        if (prop.type === 'RestElement') collectPatternBindings(prop, out);
        else collectPatternBindings(prop.value, out);
      }
      break;
    case 'Property':
      collectPatternBindings(pattern.value, out);
      break;
    default:
      break;
  }
}

function isReferenceIdentifier(node, parent) {
  if (!parent) return true;
  if (parent.type === 'Property' && parent.key === node && !parent.computed && parent.value !== node) return false;
  if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return false;
  if (parent.type === 'VariableDeclarator' && parent.id === node) return false;
  if (
    (parent.type === 'FunctionDeclaration' ||
      parent.type === 'FunctionExpression' ||
      parent.type === 'ClassDeclaration' ||
      parent.type === 'ClassExpression') &&
    parent.id === node
  ) {
    return false;
  }
  if (parent.type === 'AssignmentPattern' && parent.left === node) return false;
  return true;
}

/**
 * Scope-aware rename of the webpack wrapper params (module / exports / require).
 * Returns a list of { start, end, newName } ranges in ABSOLUTE source offsets,
 * for identifiers that resolve to the module function's own scope.
 */
function analyzeScope(fnNode, renameMap) {
  const renameNodes = [];
  // Rename the module function's OWN parameter declarations (position -> name).
  for (const p of fnNode.params) {
    const ids = [];
    collectPatternBindings(p, ids);
    for (const id of ids) {
      if (Object.prototype.hasOwnProperty.call(renameMap, id.name)) {
        renameNodes.push({ node: id, newName: renameMap[id.name] });
      }
    }
  }
  const moduleScope = makeScope(null, true);
  for (const p of fnNode.params) {
    const binds = [];
    collectPatternBindings(p, binds);
    for (const b of binds) moduleScope.names.add(b.name);
  }

  function makeScope(parent, isFn) { return { parent: parent, isFn: !!isFn, names: new Set() }; }
  function nearestFnScope(scope) { let s = scope; while (s && !s.isFn) s = s.parent; return s || scope; }
  function resolve(name, scope) { let s = scope; while (s) { if (s.names.has(name)) return s; s = s.parent; } return null; }

  function isNewScope(node) {
    switch (node.type) {
      case 'BlockStatement':
      case 'ForStatement':
      case 'ForInStatement':
      case 'ForOfStatement':
      case 'SwitchStatement':
      case 'WhileStatement':
      case 'DoWhileStatement':
      case 'IfStatement':
      case 'TryStatement':
      case 'CatchClause':
        return true;
      default:
        return false;
    }
  }

  function walk(node, scope, parent) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const c of node) walk(c, scope, node); return; }
    if (!node.type) return;

    if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
      const newScope = makeScope(scope, true);
      const binds = [];
      for (const p of node.params) collectPatternBindings(p, binds);
      for (const b of binds) newScope.names.add(b.name);
      if (node.type === 'FunctionDeclaration' && node.id) scope.names.add(node.id.name);
      else if ((node.type === 'FunctionExpression' || node.type === 'ClassExpression') && node.id) newScope.names.add(node.id.name);
      for (const p of node.params) if (p.type === 'AssignmentPattern') walk(p.right, scope, p);
      walkBody(node, newScope);
      return;
    }
    if (node.type === 'ClassDeclaration') {
      if (node.id) scope.names.add(node.id.name);
      if (node.superClass) walk(node.superClass, scope, node);
      if (node.body) walk(node.body, scope, node);
      return;
    }
    if (node.type === 'ClassExpression') {
      const newScope = makeScope(scope, false);
      if (node.id) newScope.names.add(node.id.name);
      if (node.superClass) walk(node.superClass, scope, node);
      if (node.body) walk(node.body, newScope, node);
      return;
    }
    if (isNewScope(node)) {
      const newScope = makeScope(scope, false);
      if (node.type === 'CatchClause' && node.param) {
        const binds = [];
        collectPatternBindings(node.param, binds);
        for (const b of binds) newScope.names.add(b.name);
      }
      walkBody(node, newScope);
      return;
    }
    if (node.type === 'VariableDeclaration') {
      const target = node.kind === 'var' ? nearestFnScope(scope) : scope;
      for (const d of node.declarations) {
        const binds = [];
        collectPatternBindings(d.id, binds);
        for (const b of binds) target.names.add(b.name);
        if (d.init) walk(d.init, scope, d);
      }
      return;
    }

    if (node.type === 'Identifier') {
      if (isReferenceIdentifier(node, parent) && Object.prototype.hasOwnProperty.call(renameMap, node.name)) {
        if (resolve(node.name, scope) === moduleScope) {
          renameNodes.push({ node: node, newName: renameMap[node.name] });
        }
      }
      return;
    }

    for (const k of Object.keys(node)) {
      if (k === 'type' || k === 'start' || k === 'end' || k === 'loc' || k === 'range') continue;
      walk(node[k], scope, node);
    }
  }

  function walkBody(node, scope) {
    for (const k of Object.keys(node)) {
      if (k === 'type' || k === 'start' || k === 'end' || k === 'loc' || k === 'range') continue;
      walk(node[k], scope, node);
    }
  }

  walk(fnNode.body, moduleScope, fnNode);
  return renameNodes;
}

// ---------------------------------------------------------------------------
// Extract entry id + externals from the full source
// ---------------------------------------------------------------------------
function detectEntry(source) {
  const m = source.match(/var\s+__webpack_exports__\s*=\s*__webpack_require__\((\d+)\)/);
  if (m) return m[1];
  const all = [...source.matchAll(/__webpack_require__\((\d+)\)/g)];
  if (all.length) return all[all.length - 1][1];
  return null;
}

function detectExternals(source) {
  // module bodies look like: <id>(eA){ if(void 0===__rspack_external__59547){...Cannot find module 'chokidar'...} eA.exports=__rspack_external__59547 }
  const externals = {};
  const re = /__rspack_external__(\d+)/g;
  let m;
  while ((m = re.exec(source))) {
    const id = m[1];
    const around = source.slice(Math.max(0, m.index - 400), m.index + 400);
    const pkg = (around.match(/Cannot find module ['"]([^'"]+)['"]/) || [])[1];
    if (pkg) externals[id] = pkg;
  }
  return externals;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.bundle) {
    process.stdout.write(HELP);
    if (!args.bundle && !args.help) process.exit(1);
    return;
  }

  const outDir = path.resolve(args.out || 'out');

  let bundlePath;
  let bundleUrl = null;
  let fetchAssets = args.fetchAssets;

  if (isUrl(args.bundle)) {
    bundleUrl = args.bundle;
    if (fetchAssets === null) fetchAssets = true;
    const cacheDir = getCacheDir();
    const cachedName = urlBasename(bundleUrl);
    bundlePath = path.join(cacheDir, cachedName);
    console.log(`[packscope] downloading ${bundleUrl} ...`);
    try {
      const info = await downloadUrl(bundleUrl, bundlePath);
      console.log(`[packscope] downloaded ${info.size} bytes -> ${bundlePath}`);
    } catch (e) {
      console.error(`[packscope] failed to download ${bundleUrl}: ${e.message}`);
      process.exit(1);
    }
  } else {
    bundlePath = path.resolve(args.bundle);
    if (fetchAssets === null) fetchAssets = false;
    if (!fs.existsSync(bundlePath)) {
      console.error(`[packscope] bundle not found: ${bundlePath}`);
      process.exit(1);
    }
  }

  console.log(`[packscope] reading ${bundlePath} ...`);
  const source = fs.readFileSync(bundlePath, 'utf8');
  console.log(`[packscope] bundle size: ${source.length} bytes`);

  const bundleType = detectBundleType(source);
  console.log(`[packscope] detected bundle type: ${bundleType}`);
  if (bundleType === 'esm') {
    fs.mkdirSync(outDir, { recursive: true });
    const baseRef = bundleUrl || pathToFileURL(bundlePath).href;
    await unpackEsModule(source, baseRef, outDir, args);
    return;
  }

  console.log('[packscope] parsing with acorn ...');
  const t0 = Date.now();
  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
  console.log(`[packscope] parsed in ${Date.now() - t0} ms`);

  const declarator = findWebpackModulesNode(ast);
  if (!declarator || !declarator.init || declarator.init.type !== 'ObjectExpression') {
    throw new Error('Could not find `var __webpack_modules__ = {...}` in the bundle');
  }
  const objExpr = declarator.init;
  const modulesObjStart = objExpr.start; // index of '{'
  const modulesObjEnd = objExpr.end; // index after '}'
  console.log(`[packscope] __webpack_modules__ object: ${modulesObjStart}..${modulesObjEnd}`);

  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(path.join(outDir, 'modules'), { recursive: true });

  // header = everything up to and including the opening brace
  fs.writeFileSync(path.join(outDir, 'header.js'), source.slice(0, modulesObjStart + 1));
  // webpack-runtime = from the closing brace onward (starts with '}')
  fs.writeFileSync(path.join(outDir, 'webpack-runtime.js'), source.slice(modulesObjEnd - 1));

  const entry = args.entry || detectEntry(source);
  const externals = detectExternals(source);
  console.log(`[packscope] entry module: ${entry}`);
  console.log(`[packscope] externals: ${JSON.stringify(externals)}`);

  const manifest = {
    source: path.basename(bundlePath),
    sourceSize: source.length,
    entry,
    externals,
    modulesObjStart,
    modulesObjEnd,
    moduleCount: 0,
    modules: [],
  };

  let count = 0;
  let renameFail = 0;
  for (const prop of objExpr.properties) {
    const keyName = prop.key && prop.key.type === 'Identifier'
      ? prop.key.name
      : prop.key && prop.key.type === 'Literal'
        ? String(prop.key.value)
        : null;
    if (keyName === null) {
      console.warn('[packscope] skipping property without identifier/literal key');
      continue;
    }
    const fn = prop.value;
    if (!fn || fn.type !== 'FunctionExpression') {
      // non-function property (rare); keep raw
      const raw = source.slice(prop.start, prop.end);
      fs.writeFileSync(path.join(outDir, 'modules', `${keyName}.js`), raw + '\n');
      manifest.modules.push({ id: keyName, size: raw.length, deps: [], name: null, file: `modules/${keyName}.js` });
      count++;
      continue;
    }

    const bodySrc = source.slice(fn.body.start, fn.body.end);
    const paramNames = fn.params.map((p) => (p.type === 'Identifier' ? p.name : '?')).join(', ');
    // Default: keep the original (minified) module body verbatim. This is byte-
    // faithful to the bundle and is guaranteed to execute identically. The module
    // is isolated in its own file (navigable) with a documented param mapping.
    let generated = `function(${paramNames}) ${bodySrc}`;
    if (args.beautify) {
      // Opt-in pretty printing via escodegen (AST-faithful re-generation).
      // NOTE: for modules involved in fragile circular-dependency timings this can
      // change statement order and break execution; the original slices are safer.
      const renameMap = {};
      fn.params.forEach((p, i) => {
        if (p.type === 'Identifier' && POS_NAMES[i]) renameMap[p.name] = POS_NAMES[i];
      });
      if (args.rename && Object.keys(renameMap).length) {
        for (const { node, newName } of analyzeScope(fn, renameMap)) node.name = newName;
      }
      try {
        generated = escodegen.generate(fn, { format: { indent: { style: '  ' } } });
      } catch (e) {
        generated = `function(${paramNames}) ${bodySrc}`; // fall back to original slice
      }
    }
    const moduleText =
      `// webpack module ${keyName}\n` +
      `// params: ${paramNames}  (=> module, exports, require)\n` +
      `module.exports = ${generated};\n`;
    fs.writeFileSync(path.join(outDir, 'modules', `${keyName}.js`), moduleText);

    // dependencies (require(X)) from the original (pre-rename) body
    const deps = [];
    const depRe = /(?:^|[^.A-Za-z0-9_])(?:module|exports|require)\((\d+)\)/g;
    // the require param is the 3rd position name; capture by that name
    const reqName = fn.params[2] && fn.params[2].type === 'Identifier' ? fn.params[2].name : null;
    const re2 = reqName ? new RegExp(reqName + '\\((\\d+)\\)', 'g') : null;
    if (re2) {
      let dm;
      while ((dm = re2.exec(bodySrc))) if (!deps.includes(dm[1])) deps.push(dm[1]);
    }

    // best-effort "name" hint from an exported identifier / distinctive string
    const nameHint = inferName(bodySrc);

    manifest.modules.push({
      id: keyName,
      size: generated.length,
      rawSize: bodySrc.length,
      deps,
      name: nameHint,
      file: `modules/${keyName}.js`,
    });

    count++;
    if (count % 500 === 0) console.log(`[packscope] processed ${count} modules ...`);
  }

  manifest.moduleCount = count;
  manifest.assets = [];

  // Discover and optionally download referenced assets (source maps, JS/CSS URLs).
  if (fetchAssets) {
    await discoverAndFetchAssets(source, bundleUrl || bundlePath, outDir, manifest);
  }

  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // loader + entry + package.json + rebuild
  writeRuntime(outDir, manifest);
  writeEntry(outDir);
  writePackageJson(outDir, path.basename(bundlePath, '.js'));
  writeRebuild(outDir);
  linkNodeModules(outDir, bundlePath);

  console.log(`[packscope] done. ${count} modules -> ${outDir}`);
  console.log(`[packscope] run with: node ${path.relative(process.cwd(), path.join(outDir, 'index.js'))} --version`);
}

function inferName(bodySrc) {
  // Try: class/function assigned to exports
  const patterns = [
    /exports\.([A-Za-z_$][\w$]*)\s*=/,
    /module\.exports\.([A-Za-z_$][\w$]*)\s*=/,
    /exports\.default\s*=\s*(?:class|function)\s+([A-Za-z_$][\w$]*)/,
    /(class|function)\s+([A-Za-z_$][\w$]*)\s*\(/,
  ];
  for (const re of patterns) {
    const m = bodySrc.match(re);
    if (m) return m[1] || m[2] || null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// ES module bundle support (Vite / rollup / Angular esbuild)
// ---------------------------------------------------------------------------

function beautifyJs(source) {
  try {
    return jsBeautify(source, BEAUTIFY_OPTS);
  } catch (e) {
    console.warn(`[packscope] beautify failed: ${e.message}`);
    return source;
  }
}

function extractInlineSourceMap(source) {
  const m = source.match(/\/\/#\s*sourceMappingURL\s*=\s*(data:application\/json[^,]+,(.+))\s*$/m);
  if (!m) return null;
  try {
    const data = m[1];
    const comma = data.indexOf(',');
    if (comma === -1) return null;
    const b64 = data.slice(comma + 1);
    const json = Buffer.from(b64, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

function safeSourcePath(p) {
  // Turn a source path like "../../node_modules/.../foo.ts" into a safe relative path.
  return p.replace(/\.{2,}[\/\\]/g, '_/').replace(/[?#].*$/, '').replace(/[^a-zA-Z0-9._\-/\\]/g, '_');
}

function splitFromSourceMap(source, map, outDir, chunkFile) {
  if (!map || !map.sources) return [];
  const sourcesDir = path.join(outDir, 'sources');
  ensureDir(sourcesDir);
  const written = [];
  for (let i = 0; i < map.sources.length; i++) {
    const srcPath = map.sources[i];
    const content = (map.sourcesContent && map.sourcesContent[i]) || '';
    if (!content) continue;
    const safe = safeSourcePath(srcPath);
    const localFile = uniqueFilename(sourcesDir, safe);
    ensureDir(path.dirname(localFile));
    fs.writeFileSync(localFile, content);
    written.push({ original: srcPath, file: path.relative(outDir, localFile) });
  }
  return written;
}

// ---------------------------------------------------------------------------
// Best-effort ES module decomposer (read-only view)
// ---------------------------------------------------------------------------

function isMinifiedId(name) {
  return name && name.length <= 2 && /^[a-z_$][a-z0-9_$]*$/i.test(name);
}

function inferUnitName(stmt, src) {
  // Direct class/function id
  if (stmt.type === 'ClassDeclaration' && stmt.id) return stmt.id.name;
  if (stmt.type === 'FunctionDeclaration' && stmt.id) return stmt.id.name;
  if (stmt.type === 'VariableDeclaration') {
    for (const d of stmt.declarations) {
      if (d.id && d.id.type === 'Identifier') {
        const varName = d.id.name;
        let expr = d.init;
        if (expr && (expr.type === 'AssignmentPattern')) expr = expr.left;
        if (expr && (expr.type === 'ClassExpression' || expr.type === 'FunctionExpression' || expr.type === 'ArrowFunctionExpression')) {
          const exprId = expr.id && expr.id.name;
          if (exprId && !isMinifiedId(exprId)) return exprId;
          if (varName && !isMinifiedId(varName)) return varName;
          // Try to infer from the first this.<prop> assignment in the body.
          const bodySrc = src.slice(expr.start, expr.end);
          const m = bodySrc.match(/this\.(\w+)\s*=/);
          if (m) return m[1];
          return varName || exprId || 'unit';
        }
      }
    }
  }
  return 'unit';
}

function isDecomposableUnit(stmt) {
  if (stmt.type === 'ClassDeclaration') return true;
  if (stmt.type === 'FunctionDeclaration') {
    // Skip tiny Angular Ivy render helpers.
    const body = stmt.body;
    const bodyLen = body ? body.end - body.start : 0;
    return bodyLen > 200;
  }
  if (stmt.type === 'VariableDeclaration') {
    for (const d of stmt.declarations) {
      let expr = d.init;
      if (expr && expr.type === 'AssignmentPattern') expr = expr.left;
      if (!expr) continue;
      // Class/function expression
      if (expr.type === 'ClassExpression' || expr.type === 'FunctionExpression') return true;
      // CommonJS-style wrapper: var x = helper((module, exports) => {...})
      if (expr.type === 'CallExpression' &&
          expr.arguments.length === 1 &&
          (expr.arguments[0].type === 'FunctionExpression' || expr.arguments[0].type === 'ArrowFunctionExpression') &&
          expr.arguments[0].params.length === 2) {
        return true;
      }
    }
  }
  return false;
}

function safeDecomposeName(name) {
  return (name || 'unit').replace(/[^a-zA-Z0-9_.$-]/g, '_').replace(/_{2,}/g, '_').slice(0, 80) || 'unit';
}

function decomposeChunk(source, chunkFile, outDir) {
  let ast;
  try {
    ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  } catch (e) {
    return [];
  }
  const baseName = path.basename(chunkFile, path.extname(chunkFile));
  const decompDir = path.join(outDir, 'decomposed', baseName);
  ensureDir(decompDir);

  const units = [];
  const residualRanges = [];
  let lastEnd = 0;

  for (let i = 0; i < ast.body.length; i++) {
    const stmt = ast.body[i];
    if (isDecomposableUnit(stmt)) {
      const name = inferUnitName(stmt, source);
      const safe = safeDecomposeName(name);
      const wanted = `${units.length.toString().padStart(4, '0')}-${safe}.js`;
      const outFile = uniqueFilename(decompDir, wanted);
      const text =
        `// Decomposed read-only extract from ${path.basename(chunkFile)}\n` +
        `// inferred name: ${name}\n` +
        `// This file is NOT executable on its own; use it for navigation/reading only.\n\n` +
        source.slice(stmt.start, stmt.end) + '\n';
      fs.writeFileSync(outFile, text);
      units.push({ name, file: path.relative(outDir, outFile), size: text.length });
      residualRanges.push({ start: lastEnd, end: stmt.start });
      lastEnd = stmt.end;
    }
  }
  residualRanges.push({ start: lastEnd, end: source.length });

  let residual = '';
  for (const r of residualRanges) residual += source.slice(r.start, r.end);
  if (residual.trim().length > 50) {
    const residualFile = path.join(decompDir, '_residual.js');
    fs.writeFileSync(residualFile, residual);
    units.push({ name: '_residual', file: path.relative(outDir, residualFile), size: residual.length });
  }

  return units;
}

async function unpackEsModule(source, bundleUrl, outDir, args) {
  const entryBaseName = urlBasename(bundleUrl);
  const entryPath = path.join(outDir, entryBaseName);
  const chunksDir = path.join(outDir, 'chunks');
  const assetsDir = path.join(outDir, 'assets');
  ensureDir(chunksDir);
  ensureDir(assetsDir);

  const manifest = {
    bundleType: 'esm',
    source: entryBaseName,
    entry: entryBaseName,
    baseUrl: bundleUrl,
    chunks: [],
    assets: [],
    decomposed: [],
  };

  const urlToChunkFile = new Map();
  const seenUrls = new Set();
  const processedFiles = []; // { path, source, baseUrl }

  async function processSourceMap(content, baseUrl, chunkFile) {
    let map = extractInlineSourceMap(content);
    let mapUrl = null;
    if (!map) {
      const m = content.match(/\/\/#\s*sourceMappingURL\s*=\s*(.+?)\s*$/m);
      if (m) {
        const raw = m[1].trim();
        if (!raw.startsWith('data:')) {
          mapUrl = normalizeUrl(raw, baseUrl);
          if (mapUrl && isFetchableUrl(mapUrl)) {
            try {
              const smPath = path.join(outDir, 'assets', safeFilename(mapUrl));
              await downloadUrl(mapUrl, smPath);
              map = JSON.parse(fs.readFileSync(smPath, 'utf8'));
            } catch (e) {
              console.warn(`[packscope]   ! failed to fetch source map ${mapUrl}: ${e.message}`);
            }
          }
        }
      }
    }
    if (!map) return [];
    const extracted = splitFromSourceMap(content, map, outDir, chunkFile);
    if (extracted.length) {
      console.log(`[packscope]   ~ extracted ${extracted.length} source file(s) from ${path.basename(chunkFile)}`);
    }
    return extracted.map((s) => ({ ...s, mapUrl }));
  }

  async function processJsModule(url, importerUrl, depth) {
    if (!isFetchableUrl(url)) return;
    if (seenUrls.has(url)) return;
    if (depth > 10) {
      console.warn(`[packscope] max recursion depth reached, skipping ${url}`);
      return;
    }
    seenUrls.add(url);
    const localFile = allocateFile(url, chunksDir, urlToChunkFile);
    try {
      const info = await downloadUrl(url, localFile);
      console.log(`[packscope]   + chunk ${path.basename(localFile)} (${info.size} bytes) <- ${url}`);
      let content = fs.readFileSync(localFile, 'utf8');
      const imports = collectModuleImports(content, url);
      const childUrls = imports.map((i) => i.resolved).filter(Boolean);
      await withConcurrency(
        childUrls.map((cu) => () => processJsModule(cu, url, depth + 1)),
        5
      );
      content = rewriteImports(content, url, localFile, urlToChunkFile);
      const sources = await processSourceMap(content, url, localFile);
      if (args.beautify) content = beautifyJs(content);
      fs.writeFileSync(localFile, content);
      if (args.decompose) {
        const units = decomposeChunk(content, localFile, outDir);
        if (units.length) {
          manifest.decomposed.push({ chunk: path.relative(outDir, localFile), units });
          console.log(`[packscope]   ~ decomposed ${path.basename(localFile)} into ${units.length} unit(s)`);
        }
      }
      processedFiles.push({ path: localFile, source: content, baseUrl: url });
      manifest.chunks.push({
        url,
        file: path.relative(outDir, localFile),
        size: info.size,
        importer: importerUrl,
        imports: childUrls,
        sources,
      });
    } catch (e) {
      console.warn(`[packscope] failed to fetch chunk ${url}: ${e.message}`);
      manifest.chunks.push({ url, file: null, error: e.message, importer: importerUrl });
    }
  }

  const entryImports = collectModuleImports(source, bundleUrl);
  await withConcurrency(
    entryImports
      .filter((imp) => isFetchableUrl(imp.resolved))
      .map((imp) => () => processJsModule(imp.resolved, bundleUrl, 0)),
    5
  );
  let rewrittenEntry = rewriteImports(source, bundleUrl, entryPath, urlToChunkFile);
  const entrySources = await processSourceMap(rewrittenEntry, bundleUrl, entryPath);
  if (args.beautify) rewrittenEntry = beautifyJs(rewrittenEntry);
  fs.writeFileSync(entryPath, rewrittenEntry);
  if (args.decompose) {
    const units = decomposeChunk(rewrittenEntry, entryPath, outDir);
    if (units.length) {
      manifest.decomposed.push({ chunk: path.relative(outDir, entryPath), units });
      console.log(`[packscope]   ~ decomposed ${path.basename(entryPath)} into ${units.length} unit(s)`);
    }
  }
  processedFiles.unshift({ path: entryPath, source: rewrittenEntry, baseUrl: bundleUrl });

  if (args.fetchAssets) {
    await discoverEsModuleAssets(processedFiles, outDir, manifest);
  }

  manifest.entrySources = entrySources;
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  writeEsModulePackageJson(outDir, entryBaseName);
  writeEsModuleIndexHtml(outDir, entryBaseName);

  console.log(`[packscope] done. ESM bundle unpacked to ${outDir}`);
  console.log(`[packscope] entry: ${entryBaseName}`);
}

function discoverEsModuleAssets(processedFiles, outDir, manifest) {
  const assetsDir = path.join(outDir, 'assets');
  ensureDir(assetsDir);
  const urlToAssetFile = new Map();
  const seen = new Set();

  return (async function () {
    for (const { path: filePath, source, baseUrl } of processedFiles) {
      const items = scanFileAssets(source, baseUrl);
      let rewrites = [];
      for (const item of items) {
        if (!item.url || seen.has(item.url)) continue;
        seen.add(item.url);
        if (!isFetchableUrl(item.url)) continue;
        const localFile = allocateFile(item.url, assetsDir, urlToAssetFile);
        try {
          const info = await downloadUrl(item.url, localFile);
          console.log(`[packscope]   + asset ${path.basename(localFile)} (${info.size} bytes) <- ${item.url}`);
          manifest.assets.push({
            type: item.type,
            url: item.url,
            raw: item.raw,
            file: path.relative(outDir, localFile),
            size: info.size,
          });
          if (item.start != null && item.end != null) {
            let rel = path.relative(path.dirname(filePath), localFile).replace(/\\/g, '/');
            if (!rel.startsWith('.')) rel = './' + rel;
            rewrites.push({ start: item.start, end: item.end, text: JSON.stringify(rel) });
          }
        } catch (e) {
          console.warn(`[packscope]   ! failed to fetch asset ${item.url}: ${e.message}`);
          manifest.assets.push({
            type: item.type,
            url: item.url,
            raw: item.raw,
            file: null,
            size: 0,
            error: e.message,
          });
        }
      }
      if (rewrites.length) {
        const rewritten = applyReplacements(fs.readFileSync(filePath, 'utf8'), rewrites);
        fs.writeFileSync(filePath, rewritten);
      }
    }
  })();
}

function scanFileAssets(source, baseUrl) {
  const items = [];
  // source map reference
  const smRe = /\/\/#\s*sourceMappingURL\s*=\s*(.+?)\s*$/gm;
  let m;
  while ((m = smRe.exec(source))) {
    const raw = m[1].trim();
    const url = baseUrl ? normalizeUrl(raw, baseUrl) : null;
    if (url) items.push({ type: 'source-map', url, raw });
  }
  // new URL('...', import.meta.url) asset references
  try {
    const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
    function walk(node) {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { for (const c of node) walk(c); return; }
      if (!node.type) return;
      if (
        node.type === 'NewExpression' &&
        node.callee.type === 'Identifier' &&
        node.callee.name === 'URL' &&
        node.arguments[0] &&
        node.arguments[0].type === 'Literal' &&
        typeof node.arguments[0].value === 'string' &&
        node.arguments[1] &&
        node.arguments[1].type === 'MemberExpression' &&
        node.arguments[1].object.type === 'MetaProperty' &&
        node.arguments[1].object.meta.name === 'import' &&
        node.arguments[1].object.property.name === 'meta' &&
        node.arguments[1].property.type === 'Identifier' &&
        node.arguments[1].property.name === 'url'
      ) {
        const raw = node.arguments[0].value;
        const url = baseUrl ? normalizeUrl(raw, baseUrl) : null;
        if (url) {
          items.push({
            type: 'asset-url',
            url,
            raw,
            start: node.arguments[0].start,
            end: node.arguments[0].end,
          });
        }
      }
      for (const k of Object.keys(node)) {
        if (k === 'type' || k === 'start' || k === 'end' || k === 'loc' || k === 'range') continue;
        walk(node[k]);
      }
    }
    walk(ast);
  } catch (e) {
    // ignore parse errors during asset scanning
  }
  // bare absolute URL strings that look like static assets
  const urlRe = /https?:\/\/[^\s"'<>(){}[\]`]+/g;
  while ((m = urlRe.exec(source))) {
    const url = m[0].replace(/[.,;!?]+$/, '');
    if (isAssetUrl(url)) items.push({ type: 'asset-url', url, raw: url });
  }
  return items;
}

function writeEsModulePackageJson(outDir, entryBaseName) {
  const name = path.basename(entryBaseName, path.extname(entryBaseName)) + '-unpacked';
  const pkg = {
    name,
    version: '0.0.0',
    private: true,
    type: 'module',
    main: entryBaseName,
  };
  fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
}

function writeEsModuleIndexHtml(outDir, entryBaseName) {
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Unpacked ESM bundle</title>
</head>
<body>
  <script type="module" src="./${entryBaseName.replace(/"/g, '&quot;')}"></script>
</body>
</html>
`;
  fs.writeFileSync(path.join(outDir, 'index.html'), html);
}

// ---------------------------------------------------------------------------
// Asset discovery / download
// ---------------------------------------------------------------------------
const ASSET_EXTS = new Set([
  'js', 'mjs', 'cjs', 'css', 'json', 'map',
  'svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico',
  'woff', 'woff2', 'ttf', 'eot', 'otf',
]);

function isAssetUrl(u) {
  try {
    const urlObj = new URL(u);
    const ext = path.extname(urlObj.pathname).replace(/^\./, '').toLowerCase();
    return ASSET_EXTS.has(ext);
  } catch (e) {
    return false;
  }
}

function normalizeUrl(u, base) {
  try {
    return new URL(u, base).toString();
  } catch (e) {
    return null;
  }
}

function isFetchableUrl(url) {
  return url && (/^https?:/.test(url) || url.startsWith('file:'));
}

async function withConcurrency(tasks, limit) {
  const results = [];
  const executing = [];
  for (const task of tasks) {
    const p = Promise.resolve(task());
    results.push(p);
    executing.push(p);
    p.then(() => {
      const i = executing.indexOf(p);
      if (i !== -1) executing.splice(i, 1);
    });
    if (executing.length >= limit) await Promise.race(executing);
  }
  return Promise.all(results);
}

function safeFilename(u) {
  try {
    const urlObj = new URL(u);
    let name = path.basename(urlObj.pathname) || 'asset';
    name = name.split(/[?#]/)[0];
    // Sanitize for filesystem
    name = name.replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!name) name = 'asset';
    return name;
  } catch (e) {
    return 'asset';
  }
}

function uniqueFilename(dir, wanted) {
  let p = path.join(dir, wanted);
  if (!fs.existsSync(p)) return p;
  const ext = path.extname(wanted);
  const base = wanted.slice(0, -ext.length) || wanted;
  let i = 1;
  while (true) {
    p = path.join(dir, `${base}_${i}${ext}`);
    if (!fs.existsSync(p)) return p;
    i++;
  }
}

function allocateFile(url, dir, urlToFile) {
  if (urlToFile.has(url)) return urlToFile.get(url);
  const name = safeFilename(url);
  const abs = uniqueFilename(dir, name);
  urlToFile.set(url, abs);
  return abs;
}

function collectModuleImports(source, baseUrl) {
  let ast;
  try {
    ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  } catch (e) {
    return [];
  }
  const out = [];
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const c of node) walk(c); return; }
    if (!node.type) return;
    if (
      node.type === 'ImportDeclaration' ||
      node.type === 'ExportNamedDeclaration' ||
      node.type === 'ExportAllDeclaration'
    ) {
      if (node.source && node.source.type === 'Literal' && typeof node.source.value === 'string') {
        const raw = node.source.value;
        const resolved = normalizeUrl(raw, baseUrl);
        out.push({ type: 'static', raw, resolved, start: node.source.start, end: node.source.end });
      }
    } else if (node.type === 'ImportExpression' && node.source && node.source.type === 'Literal' && typeof node.source.value === 'string') {
      const raw = node.source.value;
      const resolved = normalizeUrl(raw, baseUrl);
      out.push({ type: 'dynamic', raw, resolved, start: node.source.start, end: node.source.end });
    }
    for (const k of Object.keys(node)) {
      if (k === 'type' || k === 'start' || k === 'end' || k === 'loc' || k === 'range') continue;
      walk(node[k]);
    }
  }
  walk(ast);
  return out;
}

function applyReplacements(source, replacements) {
  replacements.sort((a, b) => a.start - b.start);
  let out = '';
  let last = 0;
  for (const r of replacements) {
    if (r.start < last) continue; // overlap guard
    out += source.slice(last, r.start);
    out += r.text;
    last = r.end;
  }
  out += source.slice(last);
  return out;
}

function rewriteImports(source, baseUrl, importerPath, urlToFile) {
  const imports = collectModuleImports(source, baseUrl);
  const reps = [];
  for (const imp of imports) {
    if (!imp.resolved || !urlToFile.has(imp.resolved)) continue;
    const target = urlToFile.get(imp.resolved);
    let rel = path.relative(path.dirname(importerPath), target).replace(/\\/g, '/');
    if (!rel.startsWith('.')) rel = './' + rel;
    reps.push({ start: imp.start, end: imp.end, text: JSON.stringify(rel) });
  }
  return applyReplacements(source, reps);
}

async function discoverAndFetchAssets(source, bundleRef, outDir, manifest) {
  const baseUrl = isUrl(bundleRef) ? bundleRef : null;
  const assetsDir = path.join(outDir, 'assets');
  ensureDir(assetsDir);

  const seen = new Set();
  const toFetch = [];

  // 1. Source map reference
  const smRe = /\/\/#\s*sourceMappingURL\s*=\s*(.+?)\s*$/gm;
  let m;
  while ((m = smRe.exec(source))) {
    const raw = m[1].trim();
    const url = baseUrl ? normalizeUrl(raw, baseUrl) : (path.isAbsolute(raw) ? `file://${raw}` : normalizeUrl(raw, `file://${path.resolve(path.dirname(bundleRef))}/`));
    if (url && !seen.has(url)) {
      seen.add(url);
      toFetch.push({ type: 'source-map', url, raw });
    }
  }

  // 2. URL strings that look like static assets (JS/CSS/images/fonts/maps).
  //    Match both quoted URLs and bare http(s) substrings.
  const urlRe = /https?:\/\/[^\s"'<>(){}[\]`]+/g;
  while ((m = urlRe.exec(source))) {
    const url = m[0].replace(/[.,;!?]+$/, '');
    if (isAssetUrl(url) && !seen.has(url)) {
      seen.add(url);
      toFetch.push({ type: 'asset-url', url, raw: url });
    }
  }

  if (!toFetch.length) return;

  console.log(`[packscope] discovering ${toFetch.length} referenced asset(s) ...`);
  for (const item of toFetch) {
    if (!isFetchableUrl(item.url)) {
      console.log(`[packscope] asset ${item.raw} is not a fetchable URL, skipping`);
      continue;
    }
    const wanted = safeFilename(item.url);
    const destPath = uniqueFilename(assetsDir, wanted);
    try {
      const info = await downloadUrl(item.url, destPath);
      console.log(`[packscope]   + asset ${path.basename(destPath)} (${info.size} bytes) <- ${item.url}`);
      manifest.assets.push({
        type: item.type,
        url: item.url,
        raw: item.raw,
        file: path.relative(outDir, destPath),
        size: info.size,
      });
    } catch (e) {
      console.warn(`[packscope]   ! failed to fetch asset ${item.url}: ${e.message}`);
      manifest.assets.push({
        type: item.type,
        url: item.url,
        raw: item.raw,
        file: null,
        size: 0,
        error: e.message,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Generated files
// ---------------------------------------------------------------------------
function writeRuntime(outDir, manifest) {
  // Reconstruct the ORIGINAL bundle shape, but make every __webpack_modules__
  // entry a thin delegator to its beautified file under ./modules. This reuses
  // the original UMD header (externals wiring) + webpack runtime verbatim, so
  // all helpers (__webpack_require__.nmd/.d/.r/.t/.a/.n/...) work as-is.
  const header = fs.readFileSync(path.join(outDir, 'header.js'), 'utf8');
  const tail = fs.readFileSync(path.join(outDir, 'webpack-runtime.js'), 'utf8');
  const props = manifest.modules.map((m) => '  ' + m.id + ': __lw(' + m.id + ')').join(',\n');

  const code =
`#!/usr/bin/env node
'use strict';
// Unpacked loader: reconstructs the original bundle, but each webpack module
// delegates to its beautified file under ./modules so the tree is both
// human-readable AND executable. The original UMD + webpack runtime
// (header.js + webpack-runtime.js) is reused verbatim.
const path = require('path');
const MODULES_DIR = path.join(__dirname, 'modules');
function loadFactory(id) {
  const f = require(path.join(MODULES_DIR, String(id) + '.js'));
  return (f && f.default) || f;
}
function __lw(id) {
  return function (module, exports, webpackRequire) {
    return loadFactory(id).call(this, module, exports, webpackRequire);
  };
}
${header}
${props}
${tail}`;
  fs.writeFileSync(path.join(outDir, 'runtime.js'), code);
  fs.chmodSync(path.join(outDir, 'runtime.js'), 0o755);
}

function writeEntry(outDir) {
  const code = `#!/usr/bin/env node
'use strict';
// Entry point: loads the unpacked loader (which runs the CLI entry module).
require('./runtime');
`;
  const p = path.join(outDir, 'index.js');
  fs.writeFileSync(p, code);
  fs.chmodSync(p, 0o755);
}

function writePackageJson(outDir, baseName) {
  const pkg = {
    name: `${baseName}-unpacked`,
    version: '0.0.0',
    private: true,
    type: 'commonjs',
    main: 'index.js',
    bin: { [baseName]: 'index.js' },
  };
  fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
}

function writeRebuild(outDir) {
  const code = `#!/usr/bin/env node
'use strict';
// Re-concatenate the (possibly hand-edited) module files back into a single
// runnable bundle: header + modules + webpack-runtime.
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

const outDir = __dirname;
const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
const outputName = process.argv[2] || 'bundle-unpacked.js';
const outputPath = path.join(outDir, outputName);

const parts = [fs.readFileSync(path.join(outDir, 'header.js'), 'utf8')];
const props = [];
for (const mod of manifest.modules) {
  const filePath = path.join(outDir, mod.file);
  const src = fs.readFileSync(filePath, 'utf8');
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script' });
  // find the factory FunctionExpression
  let fn = null;
  (function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.type === 'FunctionExpression' && n.body && n.body.type === 'BlockStatement') { fn = n; return; }
    for (const k of Object.keys(n)) {
      if (k === 'type' || k === 'start' || k === 'end' || k === 'loc' || k === 'range') continue;
      const c = n[k];
      if (c && typeof c === 'object') walk(c);
    }
  })(ast);
  if (!fn) { console.error('skip', mod.id); continue; }
  const paramsSrc = fn.params.length ? src.slice(fn.params[0].start, fn.params[fn.params.length - 1].end) : '';
  const bodySrc = src.slice(fn.body.start, fn.body.end);
  props.push(\`\${mod.id}(\${paramsSrc}) \${bodySrc}\`);
}
parts.push(props.join(',\\n'));
parts.push(fs.readFileSync(path.join(outDir, 'webpack-runtime.js'), 'utf8'));

fs.writeFileSync(outputPath, parts.join(''));
console.log('[rebuild] wrote ' + outputPath + ' (' + fs.statSync(outputPath).size + ' bytes)');
`;
  fs.writeFileSync(path.join(outDir, 'rebuild.js'), code);
  fs.chmodSync(path.join(outDir, 'rebuild.js'), 0o755);
}

function linkNodeModules(outDir, bundlePath) {
  let dir = path.dirname(bundlePath);
  while (dir !== path.dirname(dir)) {
    const nm = path.join(dir, 'node_modules');
    if (fs.existsSync(nm) && fs.statSync(nm).isDirectory()) {
      const link = path.join(outDir, 'node_modules');
      try { fs.unlinkSync(link); } catch (e) {}
      try { fs.symlinkSync(nm, link); } catch (e) {}
      return;
    }
    dir = path.dirname(dir);
  }
}

main().catch((e) => {
  console.error('[packscope] error:', e);
  process.exit(1);
});
