# siyuan-tinymist

> Live Typst preview for [SiYuan Note](https://b3log.org/siyuan) via embedded [tinymist](https://github.com/Myriad-Dreamin/tinymist) (Typst LSP + preview server).

[中文说明](./README_zh_CN.md)

## What it does

Spawns a `tinymist preview` child process, connects to its WebSocket, and renders the incremental SVG preview in a SiYuan tab. The preview reuses tinymist's built-in frontend (reflexo WASM renderer), so you get the same low-latency live preview + bidirectional source↔preview navigation as the VSCode tinymist extension.

**Desktop only.** Mobile / browser / Docker builds disable `window.require`, so spawning `tinymist` is impossible there. The plugin loads on those frontends but only shows a "desktop only" notice.

## Status

🚧 **Early development.** Core pipeline (spawn → preview tab → entry resolution → settings) is in place but has **not been end-to-end verified on a real SiYuan desktop yet**. See [`TODO.md`](./TODO.md) §6 for the pending QA checklist.

LSP diagnostics/completion (功能 B) is deferred.

## Install

### 1. Install tinymist

siyuan-tinymist does **not** bundle the `tinymist` binary. Install it yourself (any method works):

```bash
# Cargo (build from source)
cargo install tinymist --locked

# Or download a prebuilt binary from GitHub Releases
#   https://github.com/Myriad-Dreamin/tinymist/releases
#   put it on PATH, or set its absolute path in plugin settings (step 3)
```

Verify it works:

```bash
tinymist --version
```

### 2. Install the plugin

From a release `package.zip` via SiYuan's marketplace, or for development:

```bash
git clone git@github.com:kamasylvia/siyuan-tinymist.git
cd siyuan-tinymist
pnpm install
pnpm run make-link   # symlink dev/ into SiYuan's data/plugins/
pnpm run dev         # watch mode
```

Then enable "开发者模式" in SiYuan → 设置 → 集市.

## Usage

### Trigger the preview

With a document open:

- click the **eye icon** in the top bar, **or**
- run the command **Open Typst Preview** (default hotkey `⇧⌘P`).

The plugin resolves the Typst entry, spawns `tinymist preview`, and opens a preview tab.

### How a SiYuan doc becomes `main.typ`

The plugin materializes the current document into a temp `main.typ` and feeds it to tinymist. Two modes (set via **设置 → Materialize mode** or the document attribute `custom-typst-mode`):

- **`code-blocks` (default):** extracts all ` ```typst ` fenced code blocks in document order and concatenates them. This is the recommended way to write Typst inside SiYuan — put your Typst source in `typst` code blocks.
- **`markdown`:** light markdown→Typst conversion (strips SiYuan IAL `{: ... }`, block-ref footnotes). Only basic structures compile; for complex docs prefer `code-blocks`.

If no ` ```typst ` block is found in `code-blocks` mode, the plugin reports `No typst code blocks found`.

### Entry anchoring (4 layers)

For multi-file Typst projects, `#import` relative paths must anchor to a project root. The plugin resolves the entry in this priority order:

1. **Document attribute** `custom-typst-root`: set an absolute path to your project's `main.typ`. In the doc's attribute panel (right-click doc → 属性), add `custom-typst-root` = `/abs/path/to/main.typ`. The file's parent dir becomes the project root.
2. **Session pin:** in the preview tab toolbar, click the **pin icon** → "Pin custom path..." → enter an absolute path. Pin persists for the session (cleared on plugin reload).
3. **Auto-detect** *(placeholder, not yet implemented):* look for `main.typ` in the doc's asset dir. Pending asset-mechanism integration.
4. **Single-file default:** materialize the current doc into `main.typ` (mode above). Root = the temp dir.

Layers 1/2 bypass materialization entirely — the plugin feeds your real `main.typ` to tinymist, so `#import "chapter1.typ"` resolves against your real project files.

### Document attributes reference

| Attribute | Value | Effect |
|---|---|---|
| `custom-typst-root` | absolute path to `main.typ` | Use that file as entry; its parent as root (layer 1) |
| `custom-typst-mode` | `code-blocks` \| `markdown` | Materialize mode for layer 4 (single-file default) |

## Settings

SiYuan → 设置 → 插件 → siyuan-tinymist:

| Setting | Default | Description |
|---|---|---|
| **tinymist executable path** | `tinymist` | Path to the tinymist binary. Leave as `tinymist` to use PATH. |
| **Preview server host:port** | `127.0.0.1:0` | Data-plane bind address. `:0` = random port. |
| **Materialize mode** | `code-blocks` | How a doc becomes `main.typ` (see above). |
| **Extra tinymist CLI args** | *(empty)* | Space-separated args passed to `tinymist preview`, e.g. `--invert-colors=auto`. |

Changes to `tinymistPath` / `dataPlaneHost` / `extraArgs` rebuild the manager — the running session (if any) is stopped and the next preview uses the new config.

## Requirements

- **Desktop client** (mobile / browser / Docker unsupported).
- SiYuan `>= 3.2.1` (`plugin.json` `minAppVersion`).
- `tinymist` binary reachable via PATH or settings.

## Development

```bash
pnpm install
pnpm run make-link    # symlink dev/ into SiYuan's data/plugins/
pnpm run dev          # watch mode, livereload hot reload
pnpm run build        # production build → dist/ + package.zip
```

Set your SiYuan workspace path via `SIYUAN_PLUGIN_DIR` env or let `make_dev_link.js` auto-detect.

### Architecture

```
src/
  index.ts                 plugin entry: onload/onunload, topbar+command, settings wiring
  tinymist/manager.ts      TinymistManager: spawn/kill, parse preview URL from stdout
  preview/tab.ts           preview tab (iframe → tinymist frontend), pin toolbar
  mapper/
    block-to-typ.ts        SiYuan doc → main.typ (code-blocks / markdown)
    anchor.ts              AnchorResolver: 4-layer entry resolution
  settings/index.ts        settings page (SettingUtils): path/port/mode/args
  libs/setting-utils.ts    (from frostime template) SettingUtils helper
```

## Troubleshooting

- **`tinymist not found`** — install tinymist or set its absolute path in settings.
- **`No typst code blocks found`** — add a ` ```typst ` block to the doc, or switch Materialize mode to `markdown`.
- **Preview tab blank** — check the browser console; tinymist logs go to `[tinymist]` prefix. Verify the preview URL (`http://127.0.0.1:<port>`) is reachable.
- **`#import` fails** — you're on layer 4 (materialized single file). Set `custom-typst-root` or pin a real `main.typ` so imports resolve against your project.

## Acknowledgements

- Template: [`frostime/plugin-sample-vite`](https://github.com/frostime/plugin-sample-vite) (MIT).
- Typst tooling: [`Myriad-Dreamin/tinymist`](https://github.com/Myriad-Dreamin/tinymist).
- Prior art: [`terwer/siyuan-plugin-local-service`](https://github.com/terwer/siyuan-plugin-local-service), [`Clouder0/siyuan-typst-plugin`](https://github.com/Clouder0/siyuan-typst-plugin).

## License

MIT © kamasylvia. Template portions © frostime / SiYuan contributors.
