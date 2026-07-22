---
title: CLI 参考
description: Packscope CLI 选项完整参考。
order: 3
---

## 语法

```bash
npx packscope <bundle.js|URL> <输出目录> [选项]
```

## 选项

| 选项 | 说明 |
|------|------|
| `--beautify` | 美化输出。webpack/rspack:通过 escodegen 重新生成模块体。ES 模块 bundle:用 js-beautify 美化分块。尽力而为。 |
| `--decompose` | 对 ES 模块 bundle,将顶层类、服务、函数与 CommonJS 包装提取到 `decomposed/` 树。只读,不可执行。 |
| `--rename` | 将 3 个包装参数重命名为 `module`/`exports`/`require`。仅与 webpack/rspack 的 `--beautify` 一起生效。 |
| `--fetch-assets` | 自动下载引用的 source map 与资源 URL(URL 输入默认开启,本地文件默认关闭)。 |
| `--no-fetch-assets` | 跳过下载引用的资源。 |
| `--entry <N>` | 强制指定入口模块 ID(否则自动检测)。 |
| `--devtools` | 将原始 URL 路径镜像到 `<输出目录>`,用于 Chrome DevTools 本地覆盖。 |

## 示例

```bash
# 基础本地解包
npx packscope ./examples/node_large_example.js ./out

# 从 URL 解包并美化
npx packscope https://example.com/app.js ./out --beautify

# ES 模块 bundle 带分解
npx packscope https://example.com/main-ABCD1234.js ./out --decompose

# DevTools 覆盖模式
npx packscope --devtools https://example.com/assets/index-CLHtNMqj.js ./out
```
