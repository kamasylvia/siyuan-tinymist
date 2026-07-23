# siyuan-tinymist TODO

> Fork: `kamasylvia/siyuan-tinymist`(基于 `frostime/plugin-sample-vite` 模板)
> 维护人：Laniakea Kamasylvia
> 最近更新：2026-07-23

---

## 0. 项目目标

给思源笔记加 Typst 实时预览能力,通过嵌入 tinymist(Typst LSP + preview server)实现。

### 两个核心功能

1. **Typst 实时预览** —— spawn tinymist 子进程,经 WebSocket 接 SVG 增量渲染,在思源 preview tab / 正文内联显示。支持多文件项目 + `#import` 相对路径锚点(对齐 VSCode tinymist 体验)。
2. **(可选,LSP 能力)** 编辑器内诊断、补全、跳转 —— 接 tinymist LSP over stdio。**优先级低于 preview**,先不做。

### 设计依据(已调研确认)

- **思源插件 = Electron renderer 全权 Node 公民**:`nodeIntegration:true` + `contextIsolation:false` + `webSecurity:false`(`app/electron/main.js:899-902`),CSP 被主进程主动删除(`main.js:974`)。插件可 `window.require('child_process').spawn(...)`,可 `new WebSocket('ws://127.0.0.1:*')`,无 sandbox 阻断。
- **纯插件可实现,无需改思源 kernel 或前端源码**。所有阻塞 Joplin 的点(sandbox 禁 spawn / CSP 禁 ws / IPC 代理)在思源都放行。
- **现成先例**:
  - `terwer/siyuan-plugin-local-service` —— 思源里 spawn Node/Python/Java 子进程的生产级插件,`zhi-device` 底层 `siyuanWindow().require('child_process')`。
  - `Clouder0/siyuan-typst-plugin` —— 思源 + typst.ts wasm,块级内联 SVG(没做整文档 preview,留给我们补)。
- **约束**:仅桌面端生效(移动/Docker/浏览器端编译宏 `BROWSER` 裁掉 `window.require`)。tinymist preview 本就桌面向,可接受。

---

## 1. 仓库拓扑

| Remote | URL | 用途 |
|---|---|---|
| `origin` | `git@github.com:kamasylvia/siyuan-tinymist.git` | fork 主推送目标(SSH,已就位) |
| `template` | `git@github.com:frostime/plugin-sample-vite.git` | 模板上游(可选,追踪模板更新) |

- 模板是社区维护(frostime),非官方 org。官方 vite 系只有 `siyuan-note/plugin-sample-vite-svelte` / `-vue`,纯 TS 无框架版只有 frostime 这个。
- **CI**:`.github/workflows/release.yml` 已带(打 `package.zip` 上 Release),暂不启用 Actions,基础功能完成后再考虑(对齐 tolaria 策略)。
- **本地 git 走 SSH**(全局约束 §2.5),不拼 PAT 进 remote。

---

## 2. 开发环境

### 工作目录
- 项目：`/Volumes/Ext SSD/Documents/Development/siyuan-note/siyuan-tinymist`
- 思源桌面版：本机安装 release 版用于插件开发验证(端口 6806)
- **不 build 开发版** —— Typst preview 纯插件,不用改 kernel。softlinks 若日后走路径 C(改 kernel)再考虑 fork siyuan 源码。

### 思源 workspace / data 目录(协同开发必填)

> **本仓库为多机协同开发项目,每台开发机必须本地配置思源 workspace,路径不强求一致,但必须存在且可写。** 新机器 clone 本仓后,第一件事按下方步骤建好 workspace,否则软链开发链路不通。

**本机(kamasylvia, macOS)**
- 思源 workspace:`/Volumes/Ext SSD/Documents/Development/siyuan-note/workspace`
- 启动思源时用 `--workspace` 指向该目录(或思源设置里改默认 workspace)
- 插件软链目标:`<workspace>/data/plugins/siyuan-tinymist/`(由 `pnpm run make-link` 建立,详见 §3)
- 内核 HTTP API:`http://127.0.0.1:6806`(默认端口)

**其他开发机(必填,新机器接入时在此追加)**
- `[机器名/开发者]`:
  - workspace path:`<填>`
  - 思源版本:`<填>`
  - 备注:`<填>`

**新机器配置步骤**
1. 装思源桌面版 release。
2. 选定 workspace 目录(建议放外置盘或空间充足的盘,内置 SSD 小则重定向)。
3. 启动思源指向该 workspace:`SiYuan --workspace=<path>`(macOS)/ 快捷方式加参数(Windows)。
4. 思源"设置 → 集市 → 开发者模式"启用。
5. clone 本仓后跑 `pnpm install && pnpm run make-link`(脚本会提示输入 workspace 路径,或编辑 `scripts/make_dev_link.js` 默认值)。
6. 把本机 workspace path 填进上方表格。

### 工具链(待确认本机状态)
- [ ] Node.js(模板要求,版本待对齐 `package.json` engine 字段)
- [ ] pnpm(模板 dev 脚本用 `pnpm run`)
- [ ] tinymist 二进制:用户预装 or 插件 bundle(见 §4 决策)
- [ ] Rust toolchain(仅当要自己编 tinymist 时需要,默认用预编译 release)

### 内置 SSD 保护(本机 kamasylvia,其他机器按需)
- pnpm store 重定向到外置盘:`pnpm config set store-dir /Volumes/Ext\ SSD/.pnpm/store`
- `node_modules/` 跟随项目落外置盘

---

## 3. 模板清理(✅ 已完成,待软链 QA)

模板原样 clone 下来,`name`/`author`/`url` 还是 `plugin-sample-vite`/`frostime`,要改成 siyuan-tinymist。**这是 TODO 第一步,做完才能开始功能开发。**

> 完成 commit:`ffb4eae`(2026-07-23)。代码侧全绿,软链/思源加载 QA 待本机手动验证。

- [x] `plugin.json`:
  - `name`: `plugin-sample-vite` → `siyuan-tinymist`(必须 == GitHub 仓库名,市集上架硬规则)
  - `author`: `frostime` → `kamasylvia`
  - `url`: → `https://github.com/kamasylvia/siyuan-tinymist`
  - `displayName`/`description`/`keywords`:改成 tinymist/typst 相关
  - `backends`/`frontends`:限桌面 + docker(移动/浏览器无法 spawn tinymist)
- [x] `package.json`:`name`/`author`/`description`/`repository`/`homepage` 同步改(`siyuan` 依赖 `1.1.2` 保留)
- [x] `README.md` / `README_zh_CN.md`:重写,描述 tinymist 集成
- [x] `CHANGELOG.md`:清空模板内容,从 v0.1.0 起记
- [x] `src/` 清除 demo:`index.ts` 重写为最小入口(桌面守卫);删 `api.ts`/`libs/const.ts`/`libs/dialog.ts`/`libs/promise-pool.ts`/`types/api.d.ts`;保留 `libs/setting-utils.ts` + `types/index.d.ts`(后续阶段用)
- [x] `LICENSE`:MIT,加 kamasylvia + frostime + SiYuan 三方 copyright
- [ ] `icon.png` / `preview.png`:**占位先留**(模板原图),待 tinymist/typst 主题设计素材
- [x] `pnpm install` + `pnpm run build` 无错,`dist/` 产物完整 + `package.zip` 生成

### 软链开发(待本机思源环境 QA)
- [x] 跑 `pnpm install`
- [ ] 跑 `pnpm run make-link`(脚本 `scripts/make_dev_link.js`),把 build 产物软链到思源 data/plugins/
- [ ] 思源"设置 → 集市 → 开发者模式"启用,确认插件加载
- [ ] `pnpm run dev`(watch 模式),改代码热重载验证

---

## 4. 功能 A:Typst 实时预览(核心)

**状态**:🚧 起步中(进程管理 + preview tab 骨架已落地,见下)

### 选型(已定)

**spawn tinymist 子进程 + WebSocket 接 preview SVG**

- tinymist 提供 `tinymist preview` 子命令,起 WebSocket + 静态 HTTP server,前端连 `ws://127.0.0.1:<port>` 收 SVG delta,回传 cursor/scroll 做双向同步。
- 思源 CSP 被删 + `webSecurity:false`,连本地 ws 无障碍。
- preview 容器:思源 `addTab` / `addDock` 拿 HTMLElement,塞 `<iframe src="http://127.0.0.1:<port>/">` 或 `<webview>`,或直接 WebSocket 接 SVG 自己渲染。

否决方案:
- typst.ts WASM(可作 fallback,但无增量 preview、无 LSP 能力,不如 tinymist)
- 改思源 kernel 编 Rust typst crate(没必要,插件层够)

### block ↔ 文件映射(关键设计点)

思源"一文档 = block 树(.sy JSON)",tinymist 项目入口模型是"文件系统 `.typ` + 工作目录"。三种映射策略:

| 策略 | 做法 | 评价 |
|---|---|---|
| 1. 整文档 = 一 Typst 项目 | 插件把当前思源文档物化成 `main.typ`(复用 kernel export API),喂 tinymist | 推荐起点,preview 协议原样可用 |
| 2. 单代码块 = 单次编译 | 每块独立 wasm 编译成 SVG(Clouder0 路线) | 简单,但无增量 preview、跨块引用差 |
| **3. 混合** | 编辑态 wasm 内联预览(快);"打开 preview tab" 走 spawn tinymist(整文档 + 增量 + cursor sync) | 最接近 VSCode tinymist 体验 |

**起步用策略 1**,验证核心链路(spawn + ws + svg 渲染)通后再优化到策略 3。

### 入口文件锚点(对齐 tolaria TODO §3,4 层优先级)

`#import` 相对路径要锚到项目主文件:

1. **文档 IAL 提示**:`custom-typst-root: report/main.typ` → 以该文件为入口、其父目录为 root
2. **会话手动 pin**:preview tab 工具栏"Pin entry file"
3. **自动探测**:同目录有 `main.typ` → 一键"Preview as project (main.typ)"
4. **单文件默认**:root = 笔记父目录,main = 笔记本身

### tinymist 二进制分发(待决)

| 方式 | 优点 | 缺点 |
|---|---|---|
| 用户预装 + 插件读路径 | 包体小,用户可控 | 门槛高,普通用户不会装 |
| 插件 bundle 二进制(GitHub Release 附件) | 开箱即用 | 包体大(~20-30MB),跨平台要带多份 |
| 插件首次运行下载 | 首次包小 | 要处理下载/校验/镜像 |

- [ ] **决策**:bundle 还是用户预装?倾向 bundle(参考 local-service 的 `checkAndInitNode` 模式)

### 落点(架构草图)

**插件模块划分**(待 src/ 下细化):
- `src/index.ts` —— 插件入口,`onload`/`onunload`,注册命令/tab/设置
- `src/tinymist/manager.ts` —— tinymist 进程生命周期管理(spawn/kill/restart,`onunload` 显式 kill)
- `src/tinymist/lsp.ts` —— (可选,LSP 阶段)stdio JSON-RPC client
- `src/preview/server.ts` —— 连 tinymist preview WebSocket,收 SVG delta
- `src/preview/tab.ts` —— `addTab` 注册 preview tab,渲染 SVG/iframe
- `src/preview/inline.ts` —— (策略 3)正文内联 SVG 注入 typst 代码块
- `src/mapper/block-to-typ.ts` —— 思源 block 树 → `main.typ` 物化
- `src/mapper/anchor.ts` —— 入口锚点 4 层解析
- `src/settings/index.ts` —— 设置页(tinymist 路径/端口/渲染选项)

### 交付清单

- [x] tinymist 进程管理(spawn + 生命周期 + 配置)—— `src/tinymist/manager.ts`,`TinymistManager` 类:start/stop/isRunning/getSession,spawn `tinymist preview <entry> --data-plane-host=127.0.0.1:0 --partial-rendering`,解析 stdout `Static/Data plane server listening on:` 抓 preview URL,错误分类(NotFound/Spawn/Exited/Timeout)
- [x] preview tab 骨架 —— `src/preview/tab.ts`,`createPreviewTabSpec()` 经 `Plugin.addTab` 注册,init 时塞 iframe 指向 tinymist 前端页(reflexo WASM);`src/index.ts` topbar + command 接线,`openPreviewForCurrentDoc()` 跑通 spawn→tab 链路(临时 UX:prompt 填入口路径)
- [x] 仅桌面端守卫 —— `getFrontend()` 判 desktop/desktop-window,移动端只 showMessage 不挂功能
- [x] 错误处理(起步) —— `reportError()` 按 `TinymistNotFoundError` 等给可操作文案
- [ ] preview tab + WebSocket SVG 渲染 —— 当前用 iframe 嵌 tinymist 自带前端(复用其 WASM 渲染 + 双向同步);自渲染 SVG delta 待策略 3 评估
- [ ] block → `main.typ` 物化(策略 1) —— 待落地 `src/mapper/block-to-typ.ts`,当前需用户手填 `.typ` 入口
- [ ] 入口锚点 4 层解析 + UI —— 待落地 `src/mapper/anchor.ts`
- [ ] 设置页(tinymist 路径、端口、渲染模式) —— `src/libs/setting-utils.ts` 已留,待接
- [ ] 本地化(中英) —— i18n key 已起骨架,待补全
- [ ] README + 使用文档
- [ ] `package.zip` 打包验证(GitHub Release 附件流程)

> 本机 QA 待办(纯代码侧无法完成):思源桌面端加载插件 → topbar 点开 → prompt 填一个真实 `.typ` → 确认 preview tab 显示 tinymist 渲染页;tinymist 二进制需本机预装(分发策略 §4 待决)。

---

## 5. 功能 B(可选):LSP 能力

**状态**:⏳ 暂缓,preview 完成后再评估

tinymist 是完整 LSP server,思源没有原生 LSP client 集成。若要做编辑器内诊断/补全/跳转:

- spawn tinymist `lsp` 子进程 + 自己写 stdio JSON-RPC client(可复用 `vscode-languageserver-protocol` npm 包的协议层)
- 监听 `textDocument/publishDiagnostics` → 把诊断画到 protyle 块上(DOM hack)
- completion → 思源自定义菜单
- definition/rename → LSP + 思源块定位

**判断点**:preview 做完后,评估诊断/补全的 ROI。思源编辑 Typst 主要在代码块里,诊断价值取决于用户是否在思源里写大段 Typst( vs 外部编辑器写完再贴)。

---

## 6. 验证清单(每个功能完成前)

- [ ] `pnpm run build` 无错
- [ ] 桌面端 native QA:思源加载插件,preview tab 正常显示
- [ ] tinymist 进程随插件卸载/思源退出正确清理(`onunload` kill,不留僵尸)
- [ ] 典型 Typst 文档(数学公式、`#import` 多文件、中文)渲染正确
- [ ] 入口锚点 4 层场景手动验证
- [ ] 移动端打开不崩溃(守卫生效,显示"仅桌面端"提示)
- [ ] `git status` 干净,demo 数据不进仓

---

## 7. 执行顺序

1. ✅ 环境(项目目录、git fork、模板 clone)
2. ✅ **模板清理(§3)** → commit `5789920`(已 push)
3. ⏳ 软链开发链路通(`make-link` + 思源加载,需本机 QA)
4. 🚧 **功能 A 起步** → tinymist 进程管理(`src/tinymist/manager.ts`)+ preview tab 骨架(`src/preview/tab.ts`+`src/index.ts` 接线)已落地,`pnpm run build` 全绿;待本机 QA 验证 spawn→ws→iframe 链路
5. ⏳ 功能 A 完善:block 物化 + 入口锚点 + 设置页
6. ⏳ 功能 A 收尾:错误处理 + 本地化 + 打包验证
7. ⏳ (可选)功能 B:LSP 能力评估
8. ⏳ 发布:GitHub Release + 思源市集上架(可选)

---

## 8. 待决问题

- [ ] **tinymist 二进制分发**:bundle vs 用户预装 vs 首次下载?(§4,倾向 bundle)
- [ ] **block → typ 映射策略**:起步用策略 1,但策略 3(混合)的 wasm 内联预览要不要做?取决于编辑态实时反馈需求强度
- [ ] **preview 容器形态**:`<iframe>` 接 tinymist 自带前端 vs 自己 WebSocket 接 SVG 渲染?前者省事但样式不可控,后者灵活但工作量大
- [ ] **思源版本兼容**:`minAppVersion` 设多少?`siyuan` 依赖 `1.1.2` 对应哪个思源版本?
- [ ] **CI / GitHub Actions**:暂不启用,基础功能完成后再考虑(对齐 tolaria)
- [ ] **市集上架**:是否上架思源官方市集?需遵守市集规范,审核流程待了解

---

## 9. 参考资源

### 官方
- 思源插件 API 类型:[siyuan-note/petal](https://github.com/siyuan-note/petal)(`siyuan.d.ts` / `kernel.d.ts`)
- 思源插件打包/上架:[siyuan-note/plugin-sample](https://github.com/siyuan-note/plugin-sample)
- 模板上游:[frostime/plugin-sample-vite](https://github.com/frostime/plugin-sample-vite)

### tinymist / typst
- tinymist preview 文档:<https://myriad-dreamin.github.io/tinymist/feature/preview.html>
- typst-preview crate(WebSocket SVG server):<https://crates.io/crates/typst-preview>
- tinymist 项目/入口模型:<https://myriad-dreamin.github.io/tinymist/feature/project.html>

### 思源架构关键引用(调研已确认)
- 插件加载机制:`app/src/plugin/loader.ts:21-28`(`window.eval` + `window.require` 透传)
- Electron webPreferences:`app/electron/main.js:899-902`(`nodeIntegration:true` 等)
- CSP 删除:`app/electron/main.js:974`
- 仅桌面端守卫依据:`app/src/plugin/index.ts:16`(`#if !BROWSER`)

### 先例插件
- spawn 子进程:[terwer/siyuan-plugin-local-service](https://github.com/terwer/siyuan-plugin-local-service)
- typst.ts wasm:[Clouder0/siyuan-typst-plugin](https://github.com/Clouder0/siyuan-typst-plugin)
- DOM hack 文档树:[zxkmm/siyuan_doctree_fake_subfolder](https://github.com/zxkmm/siyuan_doctree_fake_subfolder)(softlinks 参考用,本插件暂不涉及)
