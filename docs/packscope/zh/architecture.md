---
title: 架构
description: Packscope 如何解包 bundle 并重建可执行的模块树。
order: 5
---

本文档描述 Packscope 的底层工作原理。理解架构有助于调试解包问题或为项目贡献代码。

## 概览

Packscope 接收单个 JavaScript bundle 文件,产出一个由各模块文件组成的目录;这些模块在通过重建的运行时加载时,执行方式与原始 bundle 完全相同。

关键洞察是:**我们不复刻 webpack 运行时** —— 而是原样复用原始运行时。

## 检测:定位模块字典

Packscope 用 [acorn](https://github.com/acornjs/acorn) 解析 bundle,并通过**形态**(而非名字)定位 webpack 模块字典:

1. 找到 webpack 风格的 require 函数 —— 即调用 `<modules>[id].call(m, e, r)` 或类似模式的函数。
2. 解析持有模块对象的变量(如 `__webpack_modules__`,或压缩后的 `t`)。
3. 遍历对象表达式,找出所有 `{key: function(module, exports, require) { ... }}` 条目。

无论 bundle 被多么激进地压缩,这种方法都能工作。

## 提取:忠实的函数体切片

对每个模块,Packscope 从 bundle 源码中**原样提取原始工厂函数体**。函数体被包装为:

```js
module.exports = function(eA, el, ec) { <原始函数体> };
// 或当原始包装是箭头函数时:
module.exports = (eA, el, ec) => { <原始函数体> };
```

保留原始包装形态(function vs 箭头)使 `this` 绑定语义保持一致。

### 为什么默认不美化?

我们花了大量精力尝试让美化/重新生成的函数体成为默认行为(js-beautify、escodegen、基于 AST 的重命名)。所有方法都引入了微妙的运行时回归:

| 方法 | 失败模式 |
|------|---------|
| `js-beautify` | 丢失 `var` 关键字,产生 TDZ `ReferenceError` |
| `escodegen` | 相对循环依赖改变了语句顺序,导致 `Cannot access 'x' before initialization` |
| AST 重命名(朴素) | 局部 `let el` 被参数 `el` 遮蔽,破坏 readable-stream |

生产环境的 bundle 有脆弱的循环依赖时序与 TDZ 模式。任何改变 token 位置或语句顺序的文本/AST 转换都可能破坏执行。安全的默认值是原始切片。

## 重建:加载器

加载器(`runtime.js`)重建原始 bundle 表达式:

```
header.js  +  __webpack_modules__ = { <委托属性> }  +  webpack-runtime.js
```

其中:
- **`header.js`** —— 模块字典起始 `{` 及其之前的所有内容。
- **`webpack-runtime.js`** —— 结束 `}` 及其之后的所有内容(原始运行时、入口调用、UMD 尾部)。
- **每个 `__webpack_modules__[id]`** 是一个薄委托:
  ```js
  function(module, exports, req) {
    return loadFactory(id).call(this, module, exports, req);
  }
  ```

这**100% 原样复用原始 UMD + webpack 运行时**,因此外部依赖和所有运行时 helper(`.nmd`、`.d`、`.r`、`.t`、`.a`、`.n`)都按原样工作。

## 外部依赖

外部依赖(如 `chokidar`、`fs`、`path`)从 bundle 中的 shim 模式检测(如 `Cannot find module '<pkg>'`)。它们经由与原始 bundle 相同的 UMD 工厂路径接入:

```js
typeof require === 'function' ? require('<pkg>') : ...
```

## ES 模块 Bundle

对于 rollup/esbuild/Vite bundle,Packscope 会:

1. 从同一 base URL 下载入口分块(以及所有静态/动态导入的分块)。
2. 将 `import` 说明符重写为本地相对路径。
3. 可选地从内联或外部 source map 提取原始源码到 `sources/`。
4. 可选地将分块分解为顶层声明(`--decompose`)。

## `node_modules` 符号链接

许多 bundle 会修补 `globalThis.require = createRequire(__filename)`。在解包后的树中,`__filename` 指向 `out/modules/<id>.js`,因此 `createRequire` 会从 `out/` 而非原始 `dist/` 目录解析包。

Packscope 在 `out/` 中创建一个指向源项目 `node_modules` 的符号链接,让全局 `require('pkg')` 调用有机会被解析。

## 局限

- **`--beautify` 与 `--rename` 是尽力而为。** 某些有脆弱循环依赖或 TDZ 模式的模块在重新生成时可能出错。用它们来阅读,执行时回退到原始切片。
- **`node_modules` 符号链接** 指向源项目的 `node_modules`。若将解包后的树移到别处,全局 `require('pkg')` 调用可能失败,除非重新安装依赖或修复符号链接。
- **`__filename`/`__dirname`** 在 bundle 内现在看到的是解包后的文件路径,而非原始 bundle 路径。符号链接缓解了包解析问题,但对依赖路径的逻辑无效。
