# siyuan-tinymist

> 通过内嵌 [tinymist](https://github.com/Myriad-Dreamin/tinymist)(Typst LSP + preview server)为[思源笔记](https://b3log.org/siyuan)提供 Typst 实时预览。

[English](./README.md)

## 当前状态

🚧 **早期开发中。** 当前处于模板清理阶段,预览功能尚未实现,路线图见 [`TODO.md`](./TODO.md)。

## 目标

把 VSCode 级别的 Typst 实时预览带进思源:

- spawn `tinymist` 子进程,连接其 preview WebSocket,
- 在思源 preview tab / 正文内联渲染增量 SVG,
- 支持多文件 Typst 项目 + `#import` 相对路径锚点。

LSP 诊断/补全(功能 B)优先级低于 preview,先不做。

## 环境要求

- **仅桌面端。** 移动/浏览器/Docker 端裁掉了 `window.require`,无法 spawn `tinymist`。插件在不支持的前端会加载但只提示"仅桌面端"。
- 思源 `>= 3.2.1`(见 `plugin.json` 的 `minAppVersion`)。

## 开发

```bash
pnpm install
pnpm run make-link    # 把 dev/ 软链到思源 data/plugins/
pnpm run dev          # watch 模式,livereload 热重载
```

思源 workspace 路径用 `SIYUAN_PLUGIN_DIR` 环境变量指定,或让 `make_dev_link.js` 自动探测。

## 致谢

- 模板:[`frostime/plugin-sample-vite`](https://github.com/frostime/plugin-sample-vite)(MIT)。
- Typst 工具链:[`Myriad-Dreamin/tinymist`](https://github.com/Myriad-Dreamin/tinymist)。
- 先例:[`terwer/siyuan-plugin-local-service`](https://github.com/terwer/siyuan-plugin-local-service)、[`Clouder0/siyuan-typst-plugin`](https://github.com/Clouder0/siyuan-typst-plugin)。

## License

MIT © kamasylvia。模板部分 © frostime / 思源贡献者。
