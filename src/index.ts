import { Plugin, showMessage, getFrontend, openTab } from "siyuan";
import "./index.scss";

import { TinymistManager, TinymistNotFoundError, PreviewSession } from "./tinymist/manager";
import { createPreviewTabSpec, PREVIEW_TAB_TYPE, PreviewTabData } from "./preview/tab";

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
    /** 当前 preview 会话。 */
    private session: PreviewSession | null = null;

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
        this.session = null;
    }

    /**
     * 对当前打开的文档启动 preview。
     *
     * 起步阶段(策略 1,单文件):要求用户已用思源导出/或外部放好一个 `.typ` 入口文件,
     * 此处先以「占位入口」跑通 spawn → ws → iframe 链路。block → main.typ 物化
     * (TODO.md §4 落点 `src/mapper/block-to-typ.ts`)落地后替换此处。
     *
     * 当前实现:弹对话框让用户填 `.typ` 入口绝对路径(临时 UX,验证链路用)。
     */
    private async openPreviewForCurrentDoc(): Promise<void> {
        if (!this.isDesktop || !this.tinymist) {
            showMessage(this.i18n.desktopOnly);
            return;
        }

        // 临时 UX:提示用户填入口路径。后续阶段接 block 物化后改为自动取当前文档。
        const entryFile = await this.askEntryFile();
        if (!entryFile) {
            return;
        }

        // 若已有会话且入口相同,直接聚焦已开 tab。
        if (this.session) {
            this.openPreviewTab(this.session);
            return;
        }

        showMessage(this.i18n.loadingPlugin ?? "Starting tinymist...", 3000);

        try {
            const session = await this.tinymist.start(entryFile, undefined, 15000);
            this.session = session;
            this.openPreviewTab(session);
        } catch (err) {
            this.reportError(err);
        }
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

    /** 临时 UX:弹原生 prompt 让用户输入 `.typ` 入口绝对路径。后续阶段替换为自定义 Dialog + block 物化。 */
    private askEntryFile(): Promise<string | null> {
        return new Promise((resolve) => {
            // 思源 renderer(Electron)有全局 prompt。起步阶段够用。
            const input = window.prompt(
                "[siyuan-tinymist] Enter absolute path to the Typst entry file (e.g. /abs/path/main.typ):",
                "",
            );
            if (input === null) {
                resolve(null);
            } else {
                const trimmed = input.trim();
                resolve(trimmed.length > 0 ? trimmed : null);
            }
        });
    }

    /** 友好错误提示:tinymist 缺失/超时/退出分别给可操作文案。 */
    private reportError(err: unknown): void {
        console.error(`[${this.name}] preview error:`, err);
        let msg: string;
        if (err instanceof TinymistNotFoundError) {
            msg = `tinymist not found. Install it (e.g. \`cargo install tinymist\` or download from GitHub releases) and set the path in plugin settings.`;
        } else if (err instanceof Error) {
            msg = err.message;
        } else {
            msg = String(err);
        }
        showMessage(`[siyuan-tinymist] ${msg}`, 6000, "error");
    }
}
