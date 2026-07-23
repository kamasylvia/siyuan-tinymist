# Releasing siyuan-tinymist

Packaging & release flow for the plugin. Covers local package.zip verification and the GitHub Release (CI) flow.

## Prerequisites

- `plugin.json` `version` == `package.json` `version` (both bumped together).
- `pnpm run build` clean (no TS errors).
- `package.zip` contents match SiYuan's marketplace spec (see below).

## package.zip — what goes in

Built by `vite-plugin-zip-pack` from `dist/` (see `vite.config.ts`). Required files for SiYuan marketplace:

| File | Purpose |
|---|---|
| `plugin.json` | Plugin manifest (`name` MUST == repo name) |
| `index.js` | Bundled entry (`src/index.ts` → CJS) |
| `index.css` | Styles |
| `icon.png` | Marketplace icon |
| `preview.png` | Marketplace preview screenshot |
| `README.md` / `README_zh_CN.md` | Docs (referenced by `plugin.json.readme`) |
| `i18n/*.json` | Locales |

Verify locally:

```bash
pnpm run build
unzip -l package.zip        # must list exactly the files above, no extras
```

## Local install test (before release)

```bash
pnpm run make-install       # build + copy package.zip into SiYuan data/plugins/
```

Then restart SiYuan, enable the plugin, smoke-test the preview.

## Bumping version

```bash
pnpm run update-version     # scripts/update_version.js keeps plugin.json & package.json in sync
git commit -am "chore: bump version to x.y.z"
git tag vx.y.z
git push origin main --tags
```

## GitHub Release (CI)

`.github/workflows/release.yml` triggers on tag `v*` push:

1. Checkout → setup Node 20 + pnpm.
2. `pnpm install` + `pnpm build` → produces `package.zip`.
3. `ncipollo/release-action` uploads `package.zip` to the GitHub Release for that tag.

The release artifact (`package.zip` URL) is what users install via SiYuan's marketplace once the plugin is listed.

## Marketplace listing (TODO §8, not yet done)

Listing in SiYuan's official marketplace requires submitting a PR to [`siyuan-note/plugin-gallery`](https://github.com/siyuan-note/plugin-gallery) with this repo's metadata. Pending — see TODO.md §8.
