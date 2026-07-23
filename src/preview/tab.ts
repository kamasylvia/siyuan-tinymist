/**
 * Typst preview tab 注册与渲染。
 *
 * 职责(TODO.md §4 落点 `src/preview/tab.ts`):
 * - `addTab` 注册 preview tab 类型;`init` 时往容器塞一个 `<iframe>`
 *   指向 tinymist preview 前端页(reflexo WASM renderer),由后者连
 *   tinymist 的 WebSocket 收 SVG delta 自渲染。
 * - tab 通过 `data.previewUrl` 接收 tinymist manager 解析出的前端页地址。
 *
 * 选型理由(见 TODO.md §4「preview 容器形态」):
 * - iframe 嵌 tinymist 自带前端 = 最省事且完整复用其 WASM 渲染 + 双向同步,
 *   代价是样式不可控 —— 起步阶段可接受,后续策略 3 再评估自渲染 SVG。
 * - 思源 CSP 被删 + `webSecurity:false`,iframe 连本地 `http://127.0.0.1` 无障碍。
 */

import { Custom, Menu } from "siyuan";
import type { AnchorResolver } from "../mapper/anchor";

/** preview tab 类型标识(与 openTab custom.id 拼接规则配合:`plugin.name + type`)。 */
export const PREVIEW_TAB_TYPE = "tinymist-preview";

/** openTab 时透传给 tab 的数据。 */
export interface PreviewTabData {
    /** tinymist preview 前端页 URL(`http://127.0.0.1:<port>`)。 */
    previewUrl: string;
    /** 入口文件名,仅用于 tab 标题展示。 */
    entryName?: string;
    /** 锚点解析器,供 pin UI 调 setPin/clearPin。移动端/未就绪时缺省。 */
    resolver?: AnchorResolver;
    /** 当前文档 rootID,pin 到文档属性时用。 */
    docId?: string;
}

/**
 * 构造 preview tab 的 `addTab` 配置对象。
 *
 * 思源 `Plugin.addTab` 在 onload 同步期注册类型;真正实例化发生在
 * `openTab({custom:{id}})` 时,框架 new 一个 Custom 并调 `init`。
 * tab 实例的 `this.data` 即 openTab 透传的 `custom.data`。
 *
 * 用法:`this.addTab(createPreviewTabSpec())`。
 */
export function createPreviewTabSpec() {
    return {
        type: PREVIEW_TAB_TYPE,
        init(this: Custom) {
            const data = (this.data ?? {}) as PreviewTabData;
            const url = data.previewUrl;
            const element = this.element as HTMLElement;

            if (!url) {
                element.innerHTML = renderError("No preview URL provided.");
                return;
            }

            element.classList.add("siyuan-tinymist-preview");
            element.innerHTML = renderShell(url);

            const iframe = element.querySelector<HTMLIFrameElement>("iframe.tinymist-preview__frame");
            if (iframe) {
                iframe.addEventListener("error", () => {
                    element.innerHTML = renderError(`Failed to load preview from ${url}`);
                });
            }

            // Pin entry file 工具栏按钮:点开菜单设/清会话 pin(层 2)。
            const pinBtn = element.querySelector<HTMLElement>(".tinymist-preview__pin");
            if (pinBtn) {
                updatePinLabel(pinBtn, data.resolver);
                pinBtn.addEventListener("click", (ev) => {
                    openPinMenu(ev as MouseEvent, pinBtn, data.resolver);
                });
            }
        },
        destroy(this: Custom) {
            console.log(`[tinymist] preview tab destroyed`);
        },
    };
}

/** 渲染 shell:工具栏 + iframe。 */
function renderShell(previewUrl: string): string {
    return `<div class="fn__flex-1 fn__flex-column tinymist-preview__wrap">
    <div class="block__icons tinymist-preview__toolbar">
        <div class="block__logo">
            <svg class="block__logoicon"><use xlink:href="#iconEye"></use></svg>
            <span class="tinymist-preview__title">Typst Preview</span>
        </div>
        <span class="fn__flex-1 fn__space"></span>
        <span class="b3-tooltips b3-tooltips__sw tinymist-preview__pin"
              aria-label="Pin entry file / 入口锚点"
              style="cursor:pointer;padding:0 .5rem;">
            <svg class="block__logoicon"><use xlink:href="#iconPin"></use></svg>
        </span>
    </div>
    <iframe class="tinymist-preview__frame"
            src="${escapeAttr(previewUrl)}"
            frameborder="0"
            allow="clipboard-read; clipboard-write"
            style="flex:1; width:100%; border:0; background:#fff;">
    </iframe>
</div>`;
}

/**
 * 打开 pin 菜单:
 * - "Pin current entry":把当前 tinymist 入口(若 IAL/物化命中,已知路径)pin 到会话。
 * - "Pin custom path...":弹 prompt 填绝对路径 pin。
 * - "Clear pin":清会话 pin。
 */
function openPinMenu(
    ev: MouseEvent,
    pinBtn: HTMLElement,
    resolver?: AnchorResolver,
): void {
    const menu = new Menu("tinymist-pin");
    if (!resolver) {
        return; // 无 resolver(移动端/未就绪),不弹。
    }

    const current = resolver.getPinned();

    menu.addItem({
        icon: "iconPin",
        label: current ? `Pinned: ${truncate(current)}` : "Pin custom path...",
        click: () => {
            const input = window.prompt(
                "[siyuan-tinymist] Pin entry file (absolute path to main.typ):",
                current ?? "",
            );
            const trimmed = input?.trim();
            if (trimmed) {
                resolver.setPin(trimmed);
                updatePinLabel(pinBtn, resolver);
            }
        },
    });

    if (current) {
        menu.addSeparator();
        menu.addItem({
            icon: "iconClose",
            label: "Clear pin",
            click: () => {
                resolver.clearPin();
                updatePinLabel(pinBtn, resolver);
            },
        });
    }

    menu.open({ x: ev.clientX, y: ev.clientY, isLeft: true });
}

/** 根据是否已 pin 更新按钮高亮态。 */
function updatePinLabel(pinBtn: HTMLElement, resolver?: AnchorResolver): void {
    const pinned = !!resolver?.getPinned();
    pinBtn.style.opacity = pinned ? "1" : "0.55";
    pinBtn.setAttribute("aria-label", pinned ? "Pin entry (click to manage)" : "Pin entry file / 入口锚点");
}

function truncate(s: string, n = 32): string {
    return s.length > n ? "…" + s.slice(s.length - n) : s;
}

/** 渲染错误占位。 */
function renderError(message: string): string {
    return `<div class="fn__flex-1 fn__flex-center tinymist-preview__error">
    <div class="b3-typography" style="max-width:480px;text-align:center;padding:2rem;">
        <svg style="width:3rem;height:3rem;opacity:.4;"><use xlink:href="#iconAlert"></use></svg>
        <p style="margin-top:1rem;">${escapeHtml(message)}</p>
    </div>
</div>`;
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) =>
        c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
    );
}

function escapeAttr(s: string): string {
    return escapeHtml(s);
}
