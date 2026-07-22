---
title: DevTools 覆盖
description: 使用 Chrome DevTools 本地覆盖获得最快的编辑-重载循环。
order: 4
---

要在真实浏览器中获得最快的编辑-重载循环,请将 Chrome DevTools 的
**本地覆盖(Local Overrides)** 与 `--devtools` 标志结合使用。

## 设置

```bash
npx packscope --devtools https://example.com/assets/index-CLHtNMqj.js ./out
```

使用 `--devtools` 时,解包后的文件会落在与原始 URL 相同的路径下:

```
out/example.com/assets/index-CLHtNMqj.js   # 入口
out/example.com/assets/<分块>.js          # 每个导入的分块
```

## Chrome 配置

1. 打开你要调试的页面(如 `https://example.com/chatPc`)。
2. 打开 DevTools(F12)→ **Sources** 面板 → 左侧边栏 → **Overrides**。
3. 点击 **+ Select folder for overrides** 并选择 `./out` —— 即 `out/` 目录本身,**不是** `out/example.com/`。
4. 点击 **Allow**,然后启用 **Enable Local Overrides**。
5. 重新加载页面。

## 编辑与重载

- **ES 模块 bundle**(Vite / rollup / esbuild):编辑 `out/example.com/assets/` 下的任意文件并刷新 —— 改动立即生效,无需重建。
- **webpack / rspack bundle**:编辑 `out/modules/<id>.js`,然后重新生成单个 bundle:

```bash
node out/rebuild.js
```

## 为什么这样有效

- **无需本地服务器** —— Chrome 直接从磁盘提供被覆盖的文件。
- **单一源** —— 文件路径与原始 URL 匹配,因此没有混合内容、CORS 或 SSR 水合不匹配问题。
- **无解析器插入竞态** —— 替换发生在网络层,因此即使对解析器插入的 `<script type="module">` 标签也有效。
