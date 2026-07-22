---
title: 快速开始
description: 安装 Packscope 并解包你的第一个 bundle。
order: 2
---

本指南带你安装 Packscope,并解包你的第一个 JavaScript bundle。

## 前置要求

- **Node.js** >= 14.0.0

## 安装

克隆仓库并安装依赖:

```bash
git clone https://github.com/awareride/packscope.git
cd packscope
npm install
```

Packscope 有三个依赖:

| 包 | 用途 |
|---------|---------|
| [acorn](https://github.com/acornjs/acorn) | 解析 bundle AST 以定位模块边界 |
| [escodegen](https://github.com/estools/escodegen) | 在使用 `--beautify` 时重新生成代码 |
| [js-beautify](https://github.com/beautifier/js-beautify) | 在使用 `--beautify` 时美化 ES 模块分块 |

## 你的第一次解包

### 本地 bundle 文件

```bash
npx packscope ./dist/app.js ./out
```

### 从远程 URL

```bash
npx packscope https://example.com/main-ABCD1234.js ./out
```

对于 ES 模块 bundle,Packscope 会自动从同一 base URL 解析并下载所有静态与动态导入的分块,然后将导入说明符重写为本地相对路径。

## 输出布局

### webpack / rspack bundle

```
out/
├── header.js            # 原始 UMD 头部,到模块字典起始 `{` 为止
├── webpack-runtime.js   # 原始运行时 + 从 `}` 开始的尾部
├── runtime.js           # 加载器:以按文件委托的方式重建 bundle
├── index.js             # 带 shebang 的入口;运行入口模块
├── modules/
│   ├── 123.js           # 每个 webpack 模块对应一个 CommonJS 文件
│   ├── 456.js
│   └── ...
├── assets/              # 下载的 source map 与资产(使用 --fetch-assets)
├── manifest.json        # ID、体积、依赖、推断的名称
├── rebuild.js           # 重新组装为单个可运行的 bundle
├── package.json         # 自包含的 node 包元数据
└── node_modules -> ...  # 指向源项目 node_modules 的符号链接
```

### ES 模块 bundle(rollup / esbuild / Vite)

```
out/
├── <entry>.js           # 重写为本地导入的入口分块
├── chunks/              # 所有静态与动态导入的分块
├── sources/             # 来自 source map 的原始源模块
├── decomposed/          # 尽力而为的类/模块提取(使用 --decompose)
├── assets/              # 下载的 source map 与资产
├── index.html           # 将入口加载为模块的简易 HTML 页面
├── manifest.json        # bundle 类型、分块图、源文件列表
└── package.json         # 为解包后的树设置 type: "module"
```

## 运行解包后的树

### webpack / rspack 输出

```bash
node out/index.js --version
# 应打印与原始 bundle 相同的版本号

node out/index.js --help
```

### ES 模块输出

用任意静态 HTTP 服务器托管:

```bash
cd out && python3 -m http.server 8080
# 打开 http://localhost:8080/index.html
```

## 下一步

- 阅读 [CLI 参考](./cli-reference.md) 了解所有可用选项
- 了解 [DevTools 覆盖](./devtools-overrides.md) 以进行浏览器调试
- 查看 [架构](./architecture.md) 理解 Packscope 的底层工作原理
