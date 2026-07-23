# siyuan-tinymist

> Live Typst preview for [SiYuan Note](https://b3log.org/siyuan) via embedded [tinymist](https://github.com/Myriad-Dreamin/tinymist) (Typst LSP + preview server).

[中文说明](./README_zh_CN.md)

## Status

🚧 **Early development.** Template cleanup phase. Preview functionality is not yet implemented — see [`TODO.md`](./TODO.md) for the roadmap.

## Goal

Bring VSCode-grade Typst live preview into SiYuan:

- spawn a `tinymist` child process and connect to its preview WebSocket,
- render incremental SVG deltas in a SiYuan preview tab / inline,
- support multi-file Typst projects with `#import` relative-path anchoring.

LSP diagnostics/completion (功能 B) is deferred until the preview is solid.

## Requirements

- **Desktop client only.** Mobile / browser / Docker builds disable `window.require`, so spawning `tinymist` is impossible there. The plugin loads but shows a "desktop only" notice on unsupported frontends.
- SiYuan `>= 3.2.1` (see `plugin.json` `minAppVersion`).

## Development

```bash
pnpm install
pnpm run make-link    # symlink dev/ into SiYuan's data/plugins/
pnpm run dev          # watch mode, hot reload via livereload
```

Set your SiYuan workspace path via `SIYUAN_PLUGIN_DIR` env or let `make_dev_link.js` auto-detect.

## Acknowledgements

- Template: [`frostime/plugin-sample-vite`](https://github.com/frostime/plugin-sample-vite) (MIT).
- Typst tooling: [`Myriad-Dreamin/tinymist`](https://github.com/Myriad-Dreamin/tinymist).
- Prior art: [`terwer/siyuan-plugin-local-service`](https://github.com/terwer/siyuan-plugin-local-service), [`Clouder0/siyuan-typst-plugin`](https://github.com/Clouder0/siyuan-typst-plugin).

## License

MIT © kamasylvia. Template portions © frostime / SiYuan contributors.
