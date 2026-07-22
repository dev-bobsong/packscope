# Contributing to Packscope

Thanks for your interest in contributing! This document outlines the process and conventions.

## Development Setup

```bash
git clone https://github.com/awareride/packscope.git
cd packscope
npm install
```

## Project Structure

```
packscope/
├── packscope.js         # Main CLI entry point
├── docs/                # Documentation (synced to open.awareride.com)
│   └── packscope/
│       ├── en/          # English (default locale, source of truth)
│       └── zh/          # Chinese (incremental; missing pages fall back to en)
├── examples/            # Sample bundles for testing
├── test/                # Test suite
├── .github/
│   └── workflows/
│       └── sync-docs.yml
├── AGENTS.md            # Agent work log (internal)
├── LICENSE
└── README.md
```

## Running Tests

```bash
npm test
```

Tests use Node's built-in test runner. Test files live in `test/**/*.test.js`.

## Coding Conventions

- **Node.js >= 14.0.0** compatibility (CommonJS, no ES modules in the main CLI).
- Keep dependencies minimal — currently only `acorn`, `escodegen`, and `js-beautify`.
- Default behavior prioritizes **correctness over prettiness**. Original body slices are the safe default; beautify/rename are opt-in and best-effort.

## Documentation

Documentation lives in `docs/packscope/<locale>/` as Markdown files with
YAML frontmatter, mirroring the AwareRide content hub layout 1:1
(`docs/packscope/en/...` -> `src/content/docs/packscope/en/...`).

```yaml
---
title: Page Title
description: Short summary for the page.
order: 1
---
```

- `en/` is the default locale and the source of truth - it must contain every
  page. `zh/` holds Chinese translations; a missing `zh` page renders the `en`
  body on the hub with a notice, so you can translate incrementally.
- The filename (minus `.md`, relative to the locale dir) is the **slug** and
  must be byte-identical across locales (e.g. `en/getting-started.md` and
  `zh/getting-started.md`). Never translate the filename.
- Use absolute paths for internal links: `/packscope/docs/getting-started/`
  in `en/`, and `/zh/packscope/docs/getting-started/` in `zh/`.

These files are automatically synced to the central hub at
[open.awareride.com/packscope/docs/](https://open.awareride.com/packscope/docs/)
on every push to `main` (see `.github/workflows/sync-docs.yml`).

Validate locally before pushing:

```bash
node .agents/skills/awareride-content-sync/scripts/validate.mjs
```

When adding a new docs page:

1. Create the `.md` file in `docs/packscope/en/` first (required), then
   optionally `docs/packscope/zh/` with the **same filename**.
2. Set an appropriate `order` value (`index.md` is always sorted first).
3. Use the locale-correct absolute paths for internal links.

## Commit Conventions

- `feat:` — new feature
- `fix:` — bug fix
- `docs:` — documentation changes
- `refactor:` — code restructuring without behavior change
- `test:` — test additions or changes
- `chore:` — build, CI, or maintenance tasks

## Pull Request Checklist

- [ ] Tests pass (`npm test`)
- [ ] Documentation updated if needed
- [ ] Works with the example bundle: `npx packscope ./examples/node_large_example.js ./out && node out/index.js --version`
- [ ] Commit messages follow the convention above

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
