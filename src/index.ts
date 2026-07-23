import { Plugin, showMessage, getFrontend, openTab, getAllEditor } from "siyuan";
import "./index.scss";

import { TinymistManager, TinymistNotFoundError, PreviewSession } from "./tinymist/manager";
import { createPreviewTabSpec, PREVIEW_TAB_TYPE, PreviewTabData } from "./preview/tab";
import { materializeDocToTyp, MaterializedTyp, NoTypstContentError } from "./mapper/block-to-typ";

/**
 * siyuan-tinymist
 *
 * Live Typst preview for SiYuan via embedded tinymist (LSP + preview server).
 *
 * 当前阶段(TODO.md §4 起步):
 * - tinymist 进程管理(`TinymistManager`)
 * - 最小 preview tab(iframe 嵌 tinymist 自带前端页)
 * - 起步用策略 1(单文件 = 一 Typst 入口),block → main.typ 物化 + 入口锚点
 *   4 层解析在后续阶段落地。
 *
 * 桌面端专属:移动/浏览器端 `window.require` 被裁掉,无法 spawn tinymist。
 */
export default class SiYuanTinymistPlugin extends Plugin {

    /** 仅桌面端可用(可 spawn 子进程 + WebSocket)。 */
    private isDesktop: boolean = true;
    /** tinymist 进程管理器(仅桌面端实例化)。 */
    private tinymist: TinymistManager | null = null;
    /** 当前物化产物 cleanup;重物化/卸载时调。 */
    private materialized: MaterializedTyp | null = null;

    async onload() {
        const frontEnd = getFrontend();
        this.isDesktop = frontEnd === "desktop" || frontEnd === "desktop-window";

        console.log(`[${this.name}] loading; frontend=${frontEnd}; desktop=${this.isDesktop}`);

        // preview tab 类型必须在 onload 同步阶段注册。
        this.addTab(createPreviewTabSpec());

        if (!this.isDesktop) {
            // 移动/浏览器端不支持 spawn tinymist:仍注册 tab 类型(避免 openTab 时类型缺失),
            // 但不挂 topbar / command,减少误触。
            showMessage(this.i18n.desktopOnly);
            return;
        }

        this.tinymist = new TinymistManager();

        // topbar 按钮:点击触发 preview 当前文档。
        this.addTopBar({
            icon: "iconEye",
            title: this.i18n.openPreviewTab,
            position: "right",
            callback: () => {
                this.openPreviewForCurrentDoc().catch((err) => this.reportError(err));
            },
        });

        // 命令面板入口。
        this.addCommand({
            langKey: "openPreviewTab",
            hotkey: "⇧⌘P",
            callback: () => {
                this.openPreviewForCurrentDoc().catch((err) => this.reportError(err));
            },
        });
    }

    onLayoutReady() {
        console.log(`[${this.name}] layout ready`);
    }

    onunload() {
        console.log(`[${this.name}] onunload`);
        // 显式 kill tinymist,防僵尸进程(TODO.md §6)。
        this.tinymist?.stop();
        // 清理物化临时文件。
        this.materialized?.cleanup();
        this.materialized = null;
    }

    /**
     * 对当前打开的文档启动 preview。
     *
     * 策略 1(单文件 = 一 Typst 入口):
     * 1. 取当前文档 rootID(经 `getAllEditor`)。
     * 2. `materializeDocToTyp` 物化成 `<pluginDataDir>/tinymist-tmp/<rand>/main.typ`
     *    (默认抽 `​```typst` 代码块;无则报 NoTypstContentError)。
     * 3. `TinymistManager.start` spawn tinymist preview 该入口。
     * 4. openTab 打开 preview tab。
     *
     * 重物化(文档变了/再次点击):先 stop 旧会话 + cleanup 旧临时文件。
     */
    private async openPreviewForCurrentDoc(): Promise<void> {
        if (!this.isDesktop || !this.tinymist) {
            showMessage(this.i18n.desktopOnly);
            return;
        }

        const docId = this.getCurrentDocId();
        if (!docId) {
            showMessage(`[siyuan-tinymist] Please open a document first.`, 4000, "error");
            return;
        }

        // 清场:停旧会话 + 删旧物化产物,保证「当前文档」语义。
        this.tinymist.stop();
        this.materialized?.cleanup();
        this.materialized = null;

        showMessage(this.i18n.loadingPlugin ?? "Starting tinymist...", 3000);

        try {
            const typ = await materializeDocToTyp(docId, this.data.basePath);
            this.materialized = typ;

            const session = await this.tinymist.start(typ.entryPath, typ.rootDir, 15000);
            this.openPreviewTab(session);
        } catch (err) {
            // 物化/spawn 失败时清掉已建的临时产物。
            this.materialized?.cleanup();
            this.materialized = null;
            this.reportError(err);
        }
    }

    /**
     * 取当前聚焦文档的 rootID。
     *
     * 优先取 `getAllEditor()` 第一个 editor(当前打开的文档);无 editor 返回 null。
     * (后续入口锚点 4 层解析落地时,这里会接入 IAL 提示 / 手动 pin 优先级。)
     */
    private getCurrentDocId(): string | null {
        const editors = getAllEditor();
        if (editors.length === 0) {
            return null;
        }
        const rootID = editors[0].protyle?.block?.rootID;
        return rootID ?? null;
    }

    /** 打开(或聚焦)preview tab。 */
    private openPreviewTab(session: PreviewSession): void {
        const data: PreviewTabData = {
            previewUrl: session.previewUrl,
            entryName: undefined,
        };
        openTab({
            app: this.app,
            custom: {
                id: this.name + PREVIEW_TAB_TYPE,
                icon: "iconEye",
                title: this.i18n.previewTabTitle ?? "Typst Preview",
                data,
            },
        });
    }

    /** 友好错误提示:tinymist 缺失/无 typst 内容/超时/退出分别给可操作文案。 */
    private reportError(err: unknown): void {
        console.error(`[${this.name}] preview error:`, err);
        let msg: string;
        if (err instanceof TinymistNotFoundError) {
            msg = `tinymist not found. Install it (e.g. \`cargo install tinymist\` or download from GitHub releases) and set the path in plugin settings.`;
        } else if (err instanceof NoTypstContentError) {
            msg = err.message;
        } else if (err instanceof Error) {
            msg = err.message;
        } else {
            msg = String(err);
        }
        showMessage(`[siyuan-tinymist] ${msg}`, 6000, "error");
    }
}
