#!/usr/bin/env node
'use strict';

/**
 * unpack.js — unpack a mono webpack/rspack bundle into human-readable,
 * individually-executable CommonJS modules plus a loader.
 *
 * Usage: node unpack.js <bundle.js> <outDir> [--no-rename] [--entry N]
 */

const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const escodegen = require('escodegen');

// ---------------------------------------------------------------------------
// Options / CLI
// ---------------------------------------------------------------------------
const POS_NAMES = ['module', 'exports', 'require'];

function parseArgs(argv) {
  const args = { bundle: null, out: null, rename: false, beautify: false, entry: null, help: false };
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-rename') args.rename = false;
    else if (a === '--rename') args.rename = true;
    else if (a === '--no-beautify') args.beautify = false;
    else if (a === '--beautify') args.beautify = true;
    else if (a === '--entry') args.entry = argv[++i];
    else if (a === '-h' || a === '--help') args.help = true;
    else positionals.push(a);
  }
  if (positionals[0]) args.bundle = positionals[0];
  if (positionals[1]) args.out = positionals[1];
  return args;
}

const HELP = `
unpack.js — unpack a mono webpack/rspack bundle into readable, executable modules.

Usage:
  node unpack.js <bundle.js> <outDir> [options]

Options:
  --no-rename    keep obfuscated wrapper params (eA, el, ec) [DEFAULT]
  --rename       rename wrapper params to module/exports/require (opt-in, scope-aware)
  --beautify     regenerate pretty (indented) module bodies via escodegen
                [best-effort; default OFF keeps the original source slices, which are
                 guaranteed to run identically to the bundle]
  --entry <N>    force entry module id (auto-detected otherwise)
  -h, --help     show this help
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
function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.bundle) {
    process.stdout.write(HELP);
    if (!args.bundle && !args.help) process.exit(1);
    return;
  }

  const bundlePath = path.resolve(args.bundle);
  const outDir = path.resolve(args.out || 'out');
  if (!fs.existsSync(bundlePath)) {
    console.error(`[unpack] bundle not found: ${bundlePath}`);
    process.exit(1);
  }

  console.log(`[unpack] reading ${bundlePath} ...`);
  const source = fs.readFileSync(bundlePath, 'utf8');
  console.log(`[unpack] bundle size: ${source.length} bytes`);

  console.log('[unpack] parsing with acorn ...');
  const t0 = Date.now();
  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
  console.log(`[unpack] parsed in ${Date.now() - t0} ms`);

  const declarator = findWebpackModulesNode(ast);
  if (!declarator || !declarator.init || declarator.init.type !== 'ObjectExpression') {
    throw new Error('Could not find `var __webpack_modules__ = {...}` in the bundle');
  }
  const objExpr = declarator.init;
  const modulesObjStart = objExpr.start; // index of '{'
  const modulesObjEnd = objExpr.end; // index after '}'
  console.log(`[unpack] __webpack_modules__ object: ${modulesObjStart}..${modulesObjEnd}`);

  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(path.join(outDir, 'modules'), { recursive: true });

  // header = everything up to and including the opening brace
  fs.writeFileSync(path.join(outDir, 'header.js'), source.slice(0, modulesObjStart + 1));
  // webpack-runtime = from the closing brace onward (starts with '}')
  fs.writeFileSync(path.join(outDir, 'webpack-runtime.js'), source.slice(modulesObjEnd - 1));

  const entry = args.entry || detectEntry(source);
  const externals = detectExternals(source);
  console.log(`[unpack] entry module: ${entry}`);
  console.log(`[unpack] externals: ${JSON.stringify(externals)}`);

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
      console.warn('[unpack] skipping property without identifier/literal key');
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
    if (count % 500 === 0) console.log(`[unpack] processed ${count} modules ...`);
  }

  manifest.moduleCount = count;
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // loader + entry + package.json + rebuild
  writeRuntime(outDir, manifest);
  writeEntry(outDir);
  writePackageJson(outDir, path.basename(bundlePath, '.js'));
  writeRebuild(outDir);
  linkNodeModules(outDir, bundlePath);

  console.log(`[unpack] done. ${count} modules -> ${outDir}`);
  console.log(`[unpack] run with: node ${path.relative(process.cwd(), path.join(outDir, 'index.js'))} --version`);
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
const outputName = process.argv[2] || 'codebuddy-unpacked.js';
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

main();
