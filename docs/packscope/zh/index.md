---
title: 概览
description: Packscope 文档 —— 将 JavaScript bundle 解包为真实可运行的模块。
order: 1
---

Packscope 是一个开源 Node CLI,它把单个已发布的 JavaScript bundle —— 来自
**webpack**、**rspack**、**rollup**、**esbuild** 或 **Vite** —— 转换成可浏览、可执行的模块树。

## 你能做什么

- **检视** —— 每个模块都成为拥有真实边界的独立文件
- **运行** —— 解包后的树与原始 bundle 执行方式完全相同
- **编辑与重建** —— 修补任意模块并重新生成 bundle
- **从 URL 解包** —— 下载、解析分块、重写导入
- **DevTools 覆盖** —— 为 Chrome 本地覆盖镜像路径

## 快速链接

- [快速开始](/zh/packscope/docs/getting-started/) -- 安装并解包你的第一个 bundle
- [CLI 参考](/zh/packscope/docs/cli-reference/) -- 所有选项与示例
- [DevTools 覆盖](/zh/packscope/docs/devtools-overrides/) -- 最快的编辑-重载循环
- [GitHub 仓库](https://github.com/awareride/packscope)
