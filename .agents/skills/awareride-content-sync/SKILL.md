---
name: awareride-content-sync
description: Organize blog posts and product docs in this external project and sync them into the AwareRide content hub (awareride.github.io). Use when authoring markdown content under posts/ or docs/, adding translations, or setting up the GitHub Action that pushes content to the hub. Covers the en-default + zh i18n layout, slug contracts, per-page fallback, local validation, and sync workflow setup.
---

# AwareRide Content Sync

This skill is for an **external project** that contributes blog posts or
product docs to the AwareRide content hub (`awareride/awareride.github.io`).
It documents how to organize markdown content here, validate it locally, and
sync it into the hub via a GitHub Action.

The hub is an Astro 7 static site whose content lives under `src/content/`
with a locale-prefixed i18n layout: default locale `en` (no URL prefix) and
`zh` under `/zh/...`. The external project mirrors that layout 1:1, so sync
is a plain directory copy - no path rewriting.

## The layout (mirror the hub)

```
<external-project>/
  posts/
    en/
      hello-world.md            <- /posts/hello-world/ on the hub
      packscope/
        2025-07-20-why-packscope.md   <- nested dirs become path segments
    zh/
      hello-world.md            <- SAME filename as en/ (slug contract)
  docs/
    mytool/                     <- product name; must be in hub's products[]
      en/
        index.md                <- the docs landing page for this product
        getting-started.md
      zh/
        index.md                <- optional; falls back to en if absent
  .agents/skills/awareride-content-sync/      <- this skill (copied in)
    SKILL.md
    scripts/validate.mjs
    templates/sync-posts.yml
    templates/sync-docs.yml
```

`posts/` and `docs/` map directly onto the hub's
`src/content/posts/` and `src/content/docs/`, so sync copies the whole tree.

## Frontmatter schemas

### Posts (`posts/<locale>/<slug>.md`)

```yaml
---
title: "Post Title"                     # required, string
date: 2025-07-21                        # required, YYYY-MM-DD (parses to a date)
description: "One-line summary."        # required, string
tags: ["announcement", "tooling"]       # optional, defaults to []
author: "AwareRide"                     # optional, string
source: "https://github.com/awareride/packscope"  # optional, link to source
draft: false                            # optional, defaults to false; drafts are excluded from the hub
---
```

### Docs (`docs/<product>/<locale>/<slug>.md`)

```yaml
---
title: "Page Title"          # required, string
description: "Short summary" # optional, string
order: 2                     # optional, defaults to 0; controls sidebar sort order
---
```

- `index.md` is the product's docs landing page, served at `/.../docs/`
  (never `/.../docs/index/`). It is always sorted first in the sidebar
  regardless of `order`; `order` controls the remaining pages, then ties
  break by `title`.
- Docs do **not** have `date`, `tags`, `author`, or `draft`.

## The slug contract (critical)

A file's **slug** is its path relative to the locale dir, without `.md`:

| File | Slug |
|------|------|
| `posts/en/hello-world.md` | `hello-world` |
| `posts/zh/hello-world.md` | `hello-world` |
| `posts/en/packscope/2025-07-20-why-packscope.md` | `packscope/2025-07-20-why-packscope` |
| `docs/mytool/en/getting-started.md` | `getting-started` |
| `docs/mytool/zh/getting-started.md` | `getting-started` |

**The slug must be byte-identical across locales.** The hub's fallback renders
the `en` body when a `zh` page is missing, matched by slug. `en/getting-started.md`
and `zh/Getting-Started.md` would break fallback. Keep filenames identical.

When you add a localized page, always add the `en` version first - the default
locale is the source of truth and must contain every slug.

## Fallback behavior (how missing translations are handled)

Fallback is **per-page and content-level** - never a redirect:

- A `zh` page that exists renders the Chinese body, in a Chinese shell
  (`<html lang="zh">`, Chinese nav/breadcrumb).
- A `zh` page that is missing still has a URL (`/zh/.../`) on the hub; that URL
  renders the `en` body inside the Chinese shell, with a visible notice
  ("此页暂无中文翻译,以下显示英文原文。"). Post cards on `/zh/posts/`
  show an `EN` badge for fallback entries.

So you can ship `en` first and translate incrementally - the site never 404s
on a missing translation, it just shows English with a notice.

## Internal links inside content

- In an `en` post/doc, link to other pages with their default paths:
  `/posts/foo/`, `/packscope/docs/bar/`.
- In a `zh` post/doc, use the `/zh/` prefix so readers stay in the Chinese
  shell: `/zh/posts/foo/`, `/zh/packscope/docs/bar/`.
- Links to the marketing/product pages follow the same rule.
- External links (https://github.com/...) are locale-agnostic.

## Local validation (run before committing)

A Node script checks frontmatter conformance and the slug contract. It has no
dependencies (pure Node stdlib), so it runs anywhere Node 18+ is available:

```bash
node .agents/skills/awareride-content-sync/scripts/validate.mjs
```

It exits non-zero on any error, so it can gate the sync workflow. It reports:
- missing required frontmatter fields
- invalid `date` / `order` values
- a `zh` file with no matching `en` file (broken fallback)
- missing `en/` locale dir (the default locale must exist)

Run it whenever you add or rename content files.

## Syncing to the hub

Sync is a GitHub Action that copies `posts/` (and/or `docs/`) into the hub
repo on every push to `main`. It pushes to a dedicated branch and opens a
pull request against the hub's `main`, so content is reviewed before it
ships - nothing lands on `main` directly. The action uses a PAT that has
write access to `awareride/awareride.github.io`.

### 1. Create the PAT (one-time, on the hub side)

Create a fine-grained PAT (or a GitHub App token) on
`awareride/awareride.github.io` with **Contents: write** (to push the sync
branch) **and Pull requests: write** (to open the PR). Add it as a repository
secret named
`DOCS_CENTRAL_HUB_TOKEN` in the **external** project (Settings → Secrets and
variables → Actions → New repository secret).

### 2. Add the workflow(s)

Copy from `awareride-content-sync/templates/`:

- If you contribute posts: copy `sync-posts.yml` to
  `.github/workflows/sync-posts.yml`.
- If you contribute docs: copy `sync-docs.yml` to
  `.github/workflows/sync-docs.yml`.

Both run validation first, then sync. They trigger on pushes to `main` that
touch `posts/**` or `docs/**` respectively, and can be run manually via the
Actions tab ("workflow_dispatch").

### 3. Directory mapping (how the copy works)

| External | Hub |
|----------|-----|
| `posts/` | `src/content/posts/` |
| `docs/<product>/` | `src/content/docs/<product>/` |

The sync is a merge copy (not a mirror): files present in this project are
added or overwritten in the hub's `src/content/posts/` / `src/content/docs/`;
files that exist only on the hub are left untouched by the copy. This protects
content contributed by other projects from being removed when one project
restructures. To retire a page, see "Deleting content" below.

### 4. Deleting content (sync-delete.list)

Because the copy never deletes hub-only files, removing a page from this
project does **not** remove it from the hub automatically. To retire content,
use `sync-delete.list` at the external project root:

```text
# sync-delete.list - one path per line, relative to the repo root.
# Blank lines and '#' comments are ignored.
posts/en/old-post.md
posts/zh/old-post.md
docs/mytool/en/legacy-page.md
docs/mytool/en/legacy/        # trailing slash = drop the whole directory
```

Rules:

- Paths are relative to the repo root and use the same mapping as the copy
  (`posts/...` -> `src/content/posts/...`, `docs/...` -> `src/content/docs/...`).
- A single `sync-delete.list` can mix `posts/` and `docs/` entries. The
  `sync-posts` workflow only processes `posts/...` lines and the `sync-docs`
  workflow only processes `docs/...` lines; the other namespace is skipped.
- A trailing slash means "delete the whole directory".
- Unsafe paths (parent traversal `..`, absolute paths, or the bare collection
  root like `posts/`) are rejected with a warning.
- Missing entries (already gone on the hub) are a no-op, not an error.

The deletion is applied by `scripts/apply-delete-list.mjs` after the rsync
copy, so a path in `sync-delete.list` always wins over the copy. If
`sync-delete.list` is absent, the step is a no-op - so this feature is
strictly opt-in.

Both deletions and additions end up in the same reviewable pull request, so a
human still reviews what is removed before it ships.

## Registering a new product (docs only)

A product's docs only render on the hub if the product is registered in the
hub's `src/content.config.ts` `products` array:

```ts
const products = ['packscope', 'mytool'] as const;
```

This is a **one-time setup on the hub side**, not something this external
project can do via sync. When you introduce a new product:

1. Open a PR (or issue) against `awareride/awareride.github.io` adding the
   product name to `products` and creating the four route files (en + zh,
   index + catch-all) under `src/pages/<product>/docs/` and
   `src/pages/zh/<product>/docs/`. The hub's own
   `.pi/skills/awareride-content/SKILL.md` documents this for whoever owns the
   hub repo.
2. Once merged, your `docs/<product>/` content will sync and render.

Posts have no registration step - dropping a `.md` file into
`posts/<locale>/` is enough; the hub's routes already serve it.

## Hub build constraints (what breaks the hub)

The hub runs `npm run build` (Astro + `astro check`, zero errors expected).
Your content can break the hub build if:

- **Frontmatter types mismatch**: `date` not a parseable date, `order` not a
  number, `tags` not an array of strings. `validate.mjs` catches most of these.
- **Duplicate slugs within a locale**: two files resolve to the same route.
  Astro errors on this.
- **A `zh`-only slug with no `en` file**: not a build error, but the page
  renders an empty/fallback body and the slug contract is violated.
  `validate.mjs` flags it.
- **Internal links to non-existent pages**: produces a build warning (broken
  link), not an error, but should be fixed.

Run `validate.mjs` locally before pushing to catch all of these except broken
links (the hub's `astro check` reports those after sync).

## Quick reference

```bash
# Validate before pushing
node .agents/skills/awareride-content-sync/scripts/validate.mjs

# Apply a sync-delete.list against a hub checkout (used by the workflows)
node .agents/skills/awareride-content-sync/scripts/apply-delete-list.mjs \
  <hub-collection-dir> <posts|docs>

# Add a post (en + zh)
#   posts/en/my-post.md
#   posts/zh/my-post.md   (same slug; omit to fall back to en)

# Retire content: list it in sync-delete.list at the repo root
#   posts/en/old-post.md
#   docs/mytool/en/legacy/    (trailing slash = whole dir)

# Add a doc page to product "mytool" (must be registered on the hub)
#   docs/mytool/en/my-page.md
#   docs/mytool/zh/my-page.md   (optional)

# Workflows live at .github/workflows/sync-{posts,docs}.yml
# Secret on THIS repo: DOCS_CENTRAL_HUB_TOKEN
```
