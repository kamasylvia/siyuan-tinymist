import { Plugin, showMessage, getFrontend, openTab, getAllEditor } from "siyuan";
import "./index.scss";

import { TinymistManager, TinymistNotFoundError, PreviewSession, TinymistManagerOptions } from "./tinymist/manager";
import { createPreviewTabSpec, PREVIEW_TAB_TYPE, PreviewTabData } from "./preview/tab";
import { AnchorResolver, AnchorError } from "./mapper/anchor";
import { NoTypstContentError, MaterializedTyp } from "./mapper/block-to-typ";
import { setupSettings, PluginSettings, DEFAULT_SETTINGS } from "./settings";

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
    /** 入口锚点解析器(4 层:IAL > pin > 自动探测 > 物化)。 */
    private resolver: AnchorResolver | null = null;
    /** 当前生效设置(合并默认值)。 */
    private settings: PluginSettings = { ...DEFAULT_SETTINGS };
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

        // 设置页(SettingUtils 接管 this.setting)。存 this.data 防实例被 GC(元素 onchange 闭包依赖它)。
        this.data.__settingUtils = await setupSettings(this, this.i18n, (next) => this.onSettingsChange(next));

        this.applySettingsToManagers();
        this.resolver = new AnchorResolver({ pluginDataDir: this.data.basePath });

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
        console.log(`[${this.name}] onunload; settings=`, this.settings);
        // 显式 kill tinymist,防僵尸进程(TODO.md §6)。
        this.tinymist?.stop();
        // 清理物化临时文件。
        this.materialized?.cleanup();
        this.materialized = null;
    }

    /** 打开插件设置页(SettingUtils 构造时已 new Setting 赋给 this.setting)。 */
    openSetting(): void {
        this.setting.open(this.name);
    }

    /** 设置变更:更新内存值 + 重建 manager(tinymistPath/host/extraArgs 改动需新会话生效)。 */
    private onSettingsChange(next: PluginSettings): void {
        this.settings = next;
        this.applySettingsToManagers();
    }

    /** 据当前 settings 重建 TinymistManager(旧会话若在跑会被替换;下次 openPreview 用新配置)。 */
    private applySettingsToManagers(): void {
        const opts: TinymistManagerOptions = {
            binaryPath: this.settings.tinymistPath || undefined,
            dataPlaneHost: this.settings.dataPlaneHost || undefined,
            extraArgs: this.settings.extraArgs ? this.settings.extraArgs.split(/\s+/).filter(Boolean) : undefined,
        };
        // 若有运行中会话,设置改动需重启才生效 —— 停旧 manager,下次 openPreview 用新实例。
        if (this.tinymist?.isRunning()) {
            console.log(`[tinymist] settings changed; stopping running session to apply on next preview`);
            this.tinymist.stop();
            this.materialized?.cleanup();
            this.materialized = null;
        }
        this.tinymist = new TinymistManager(opts);
    }

    /**
     * 对当前打开的文档启动 preview。
     *
     * 入口经 `AnchorResolver` 按 4 层优先级解析(见 `src/mapper/anchor.ts`):
     * IAL custom-typst-root > 会话 pin > 自动探测(占位) > 物化当前文档。
     * 命中物化层时产物落 `<pluginDataDir>/tinymist-tmp/<rand>/main.typ`。
     *
     * 重物化(文档变了/再次点击):先 stop 旧会话 + cleanup 旧物化产物。
     */
    private async openPreviewForCurrentDoc(): Promise<void> {
        if (!this.isDesktop || !this.tinymist || !this.resolver) {
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
            const entry = await this.resolver.resolve(docId);
            // 物化层命中时接管 cleanup;其他层(IAL/pin)无临时产物。
            if (entry.cleanup) {
                // cleanup 包一层以更新 this.materialized 引用。
                const inner = entry.cleanup;
                this.materialized = {
                    entryPath: entry.entryFile,
                    rootDir: entry.rootDir,
                    cleanup: inner,
                } as MaterializedTyp;
            }

            console.log(`[tinymist] entry resolved via ${entry.source}: ${entry.entryFile}`);
            const session = await this.tinymist.start(entry.entryFile, entry.rootDir, 15000);
            this.openPreviewTab(session, docId);
        } catch (err) {
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

    /** 打开(或聚焦)preview tab;透传 resolver + docId 供 pin UI。 */
    private openPreviewTab(session: PreviewSession, docId: string): void {
        const data: PreviewTabData = {
            previewUrl: session.previewUrl,
            entryName: undefined,
            resolver: this.resolver ?? undefined,
            docId,
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
        } else if (err instanceof AnchorError) {
            msg = err.message;
        } else if (err instanceof Error) {
            msg = err.message;
        } else {
            msg = String(err);
        }
        showMessage(`[siyuan-tinymist] ${msg}`, 6000, "error");
    }
}
