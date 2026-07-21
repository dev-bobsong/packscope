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
│   ├── index.md
│   ├── getting-started.md
│   ├── cli-reference.md
│   ├── devtools-overrides.md
│   └── architecture.md
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

Documentation lives in `docs/` as Markdown files with YAML frontmatter:

```yaml
---
title: Page Title
description: SEO description for the page.
order: 1
---
```

These files are automatically synced to the central hub at
[open.awareride.com/packscope/docs/](https://open.awareride.com/packscope/docs/)
on every push to `main`.

When adding a new docs page:

1. Create the `.md` file in `docs/`.
2. Set an appropriate `order` value.
3. Use absolute paths for internal links (e.g., `/packscope/docs/getting-started/`).
4. Update `docs/README.md` if the file list changes.

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
