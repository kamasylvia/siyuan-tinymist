import { Plugin, showMessage, getFrontend } from "siyuan";
import "./index.scss";

/**
 * siyuan-tinymist
 *
 * Live Typst preview for SiYuan via embedded tinymist (LSP + preview server).
 *
 * Design notes (see TODO.md):
 * - 桌面端专属:移动/浏览器端 `window.require` 被裁掉,无法 spawn tinymist。
 * - tinymist 进程管理 / preview tab / block 物化 / 设置页在后续阶段逐步落地。
 */
export default class SiYuanTinymistPlugin extends Plugin {

    /** 仅桌面端可用(可 spawn 子进程 + WebSocket) */
    private isDesktop: boolean = true;

    async onload() {
        const frontEnd = getFrontend();
        this.isDesktop = frontEnd === "desktop" || frontEnd === "desktop-window";

        console.log(`[${this.name}] loading; frontend=${frontEnd}; desktop=${this.isDesktop}`);

        if (!this.isDesktop) {
            // 移动/浏览器端不支持 spawn tinymist,仅占位提示,不注册任何功能。
            showMessage(this.i18n.desktopOnly);
            return;
        }

        // TODO(§4): tinymist 进程管理 + preview tab + block 物化 + 设置页,逐阶段实现。
    }

    onunload() {
        console.log(`[${this.name}] onunload`);

        if (!this.isDesktop) {
            return;
        }

        // TODO(§4): 显式 kill tinymist 子进程,不留僵尸。
        // 设计依据:全局约束 + TODO.md §6「tinymist 进程随插件卸载正确清理」。
    }
}
