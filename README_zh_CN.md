# siyuan-tinymist

> 通过内嵌 [tinymist](https://github.com/Myriad-Dreamin/tinymist)(Typst LSP + preview server)为[思源笔记](https://b3log.org/siyuan)提供 Typst 实时预览。

[English](./README.md)

## 功能

Spawn `tinymist preview` 子进程,连接其 WebSocket,在思源页签里渲染增量 SVG 预览。预览复用 tinymist 自带前端(reflexo WASM 渲染器),因此获得与 VSCode tinymist 扩展一致的低延迟实时预览 + 源码↔预览双向跳转。

**仅桌面端。** 移动/浏览器/Docker 端裁掉了 `window.require`,无法 spawn `tinymist`。插件在这些前端会加载但只提示"仅桌面端"。

## 当前状态

🚧 **早期开发。** 核心链路(spawn → preview tab → 入口解析 → 设置页)已就位,但**尚未在真实思源桌面上端到端验证**。待办 QA 清单见 [`TODO.md`](./TODO.md) §6。

LSP 诊断/补全(功能 B)暂缓。

## 安装

### 1. 安装 tinymist

siyuan-tinymist **不 bundle** `tinymist` 二进制,需自行安装(任一方式):

```bash
# Cargo(源码编译)
cargo install tinymist --locked

# 或从 GitHub Releases 下载预编译二进制
#   https://github.com/Myriad-Dreamin/tinymist/releases
#   放到 PATH,或在插件设置里填绝对路径(见步骤 3)
```

验证:

```bash
tinymist --version
```

### 2. 安装插件

从 release `package.zip` 经思源市集安装;或开发模式:

```bash
git clone git@github.com:kamasylvia/siyuan-tinymist.git
cd siyuan-tinymist
pnpm install
pnpm run make-link   # 把 dev/ 软链到思源 data/plugins/
pnpm run dev         # watch 模式
```

然后在思源 → 设置 → 集市 启用"开发者模式"。

## 使用

### 触发预览

打开一个文档后:

- 点击顶栏的**眼睛图标**,或
- 运行命令**打开 Typst 预览**(默认快捷键 `⇧⌘P`)。

插件解析 Typst 入口 → spawn `tinymist preview` → 打开预览页签。

### 思源文档如何变成 `main.typ`

插件把当前文档物化成临时 `main.typ` 喂给 tinymist。两种模式(经 **设置 → 物化模式** 或文档属性 `custom-typst-mode` 设置):

- **`code-blocks`(默认):** 按文档顺序提取所有 ` ```typst ` 围栏代码块并拼接。**推荐**在思源里写 Typst 的方式 —— 把 Typst 源码放进 `typst` 代码块。
- **`markdown`:** 轻量 markdown→Typst 转换(去掉思源 IAL `{: ... }`、块引脚注)。仅基本结构可编译,复杂文档建议用 `code-blocks`。

`code-blocks` 模式下若文档无 ` ```typst ` 块,报 `No typst code blocks found`。

### 入口锚点(4 层)

多文件 Typst 项目里,`#import` 相对路径要锚到项目根。插件按以下优先级解析入口:

1. **文档属性** `custom-typst-root`:填项目 `main.typ` 的绝对路径。在文档属性面板(右键文档 → 属性)加 `custom-typst-root` = `/abs/path/to/main.typ`。该文件的父目录即项目根。
2. **会话 pin:** 在预览页签工具栏点 **图钉图标** → "Pin custom path..." → 填绝对路径。pin 在会话内保持(插件重载后清空)。
3. **自动探测**(*占位,未实现*):在文档 asset 目录找 `main.typ`。待接 asset 机制。
4. **单文件默认:** 物化当前文档成 `main.typ`(见上)。根目录 = 临时目录。

层 1/2 完全跳过物化 —— 插件直接把你的真实 `main.typ` 喂给 tinymist,因此 `#import "chapter1.typ"` 会解析到你的真实项目文件。

### 文档属性参考

| 属性 | 值 | 作用 |
|---|---|---|
| `custom-typst-root` | `main.typ` 绝对路径 | 以该文件为入口,其父目录为根(层 1) |
| `custom-typst-mode` | `code-blocks` \| `markdown` | 层 4(单文件默认)的物化模式 |

## 设置

思源 → 设置 → 插件 → siyuan-tinymist:

| 设置项 | 默认 | 说明 |
|---|---|---|
| **tinymist 可执行文件路径** | `tinymist` | tinymist 二进制路径。留作 `tinymist` 则用 PATH 查找。 |
| **预览服务 host:port** | `127.0.0.1:0` | 数据面绑定地址。`:0` = 随机端口。 |
| **物化模式** | `code-blocks` | 文档如何变成 `main.typ`(见上)。 |
| **额外 tinymist CLI 参数** | *(空)* | 透传给 `tinymist preview` 的参数,空格分隔,如 `--invert-colors=auto`。 |

改 `tinymistPath` / `dataPlaneHost` / `extraArgs` 会重建 manager —— 若有运行中会话会被停止,下次预览用新配置。

## 环境要求

- **桌面端**(移动/浏览器/Docker 不支持)。
- 思源 `>= 3.2.1`(`plugin.json` 的 `minAppVersion`)。
- `tinymist` 二进制经 PATH 或设置可达。

## 开发

```bash
pnpm install
pnpm run make-link    # 把 dev/ 软链到思源 data/plugins/
pnpm run dev          # watch 模式,livereload 热重载
pnpm run build        # 生产构建 → dist/ + package.zip
```

思源 workspace 路径用 `SIYUAN_PLUGIN_DIR` 环境变量指定,或让 `make_dev_link.js` 自动探测。

### 架构

```
src/
  index.ts                 插件入口:onload/onunload、topbar+command、设置接线
  tinymist/manager.ts      TinymistManager:spawn/kill、从 stdout 解析 preview URL
  preview/tab.ts           预览页签(iframe → tinymist 前端)、pin 工具栏
  mapper/
    block-to-typ.ts        思源文档 → main.typ(code-blocks / markdown)
    anchor.ts              AnchorResolver:4 层入口解析
  settings/index.ts        设置页(SettingUtils):路径/端口/模式/参数
  libs/setting-utils.ts    (来自 frostime 模板)SettingUtils 辅助
```

## 排错

- **`tinymist not found`** —— 安装 tinymist,或在设置里填其绝对路径。
- **`No typst code blocks found`** —— 文档加一个 ` ```typst ` 代码块,或把物化模式切到 `markdown`。
- **预览页签空白** —— 查浏览器控制台,tinymist 日志前缀 `[tinymist]`。确认 preview URL(`http://127.0.0.1:<port>`)可达。
- **`#import` 失败** —— 当前在层 4(物化单文件)。设 `custom-typst-root` 或 pin 真实 `main.typ`,让 import 解析到你的项目文件。

## 致谢

- 模板:[`frostime/plugin-sample-vite`](https://github.com/frostime/plugin-sample-vite)(MIT)。
- Typst 工具链:[`Myriad-Dreamin/tinymist`](https://github.com/Myriad-Dreamin/tinymist)。
- 先例:[`terwer/siyuan-plugin-local-service`](https://github.com/terwer/siyuan-plugin-local-service)、[`Clouder0/siyuan-typst-plugin`](https://github.com/Clouder0/siyuan-typst-plugin)。

## License

MIT © kamasylvia。模板部分 © frostime / 思源贡献者。
