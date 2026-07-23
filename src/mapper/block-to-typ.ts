/**
 * 思源 block 树 → Typst 入口文件物化(TODO.md §4 落点 `src/mapper/block-to-typ.ts`)。
 *
 * 策略 1(单文件 = 一 Typst 入口):把当前思源文档物化成 `main.typ` 喂 tinymist。
 *
 * 两步:
 * 1. 经思源 kernel API `/api/export/exportMdContent` 拿文档 markdown(`yfm:false`
 *    去 YAML front matter,避免污染 typst)。
 * 2. 从 markdown 提取 Typst 源:
 *    - **默认/推荐**:抽 `​```typst` 围栏代码块,拼成 main.typ。契合「在思源里用
 *      typst 代码块写 Typst」的实际用法(对齐 Clouder0 先例)。
 *    - **降级**:若无 typst 代码块,整篇 markdown 做轻量 → typst 转换(去 IAL
 *      `{: ... }`、转标题/列表/行内公式),复杂块降级为原文;只保证基本可编译。
 *
 * 产物写到插件 data 目录下的临时子目录,返回绝对路径供 `TinymistManager.start` 用。
 *
 * 设计依据:
 * - `/api/export/exportMdContent` 返回 `{hPath, content}`,content 为 markdown 字符串
 *   (源码 `kernel/api/export.go` `exportMdContent` handler)。
 * - 思源代码块在 markdown 导出里是标准 `​```lang` 围栏;typst 语言名惯例 `typst`。
 */

import { fetchSyncPost } from "siyuan";

/** typst 围栏代码块语言名(思源代码块语言标识)。 */
const TYPST_LANG = "typst";

/** 物化结果。 */
export interface MaterializedTyp {
    /** main.typ 绝对路径,喂 `TinymistManager.start` 的 entryFile。 */
    entryPath: string;
    /** 项目根目录(入口父目录),`#import` 相对路径锚点;喂 start 的 rootDir。 */
    rootDir: string;
    /** 清理临时产物;调用方在 stop/重物化时调用。幂等。 */
    cleanup: () => void;
}

/** 物化模式。 */
export type MaterializeMode = "code-blocks" | "markdown";

/** 物化选项。 */
export interface MaterializeOptions {
    /** 模式,默认 `code-blocks`。 */
    mode?: MaterializeMode;
}

/**
 * 把思源文档物化成 `main.typ`。
 *
 * @param docId 思源文档块 ID(root block id)。
 * @param pluginDataDir 插件 data 目录(`plugin.dataDir`),临时产物落于此。
 * @returns 物化结果,含入口路径 + cleanup。
 * @throws 文档无 typst 内容 / kernel API 失败 / 写文件失败。
 */
export async function materializeDocToTyp(
    docId: string,
    pluginDataDir: string,
    opts: MaterializeOptions = {},
): Promise<MaterializedTyp> {
    const mode = opts.mode ?? "code-blocks";
    const markdown = await fetchDocMarkdown(docId);

    let typSource: string;
    if (mode === "code-blocks") {
        const blocks = extractTypstCodeBlocks(markdown);
        if (blocks.length === 0) {
            throw new NoTypstContentError(
                `No \`\`\`${TYPST_LANG} code blocks found in the document. ` +
                    `Either add typst code blocks or switch to markdown mode.`,
            );
        }
        typSource = blocks.join("\n\n");
    } else {
        typSource = markdownToTyp(markdown);
        if (typSource.trim().length === 0) {
            throw new NoTypstContentError(`Document markdown is empty after conversion.`);
        }
    }

    return writeTempEntry(typSource, pluginDataDir);
}

/**
 * 调 `/api/export/exportMdContent` 拿文档 markdown。
 *
 * `yfm:false` 去 YAML front matter(思源默认会在导出加 yfm,会污染 typst)。
 * `addTitle:false` 不在开头插文档标题(标题由 typst 源自己控制)。
 */
async function fetchDocMarkdown(docId: string): Promise<string> {
    const resp = await fetchSyncPost("/api/export/exportMdContent", {
        id: docId,
        yfm: false,
        addTitle: false,
    });
    if (resp.code !== 0) {
        throw new BlockToTypError(
            `exportMdContent failed: ${resp.msg ?? "unknown error"} (code=${resp.code})`,
        );
    }
    const content = resp.data?.content;
    if (typeof content !== "string") {
        throw new BlockToTypError(`exportMdContent returned non-string content: ${typeof content}`);
    }
    return content;
}

/** typst 围栏代码块正则。捕获组 1 = 代码体。容忍语言名大小写/前后空白。 */
const TYPST_FENCE_RE = new RegExp(
    "```" + TYPST_LANG + "\\s*\\n([\\s\\S]*?)```",
    "gi",
);

/**
 * 从 markdown 提取所有 `​```typst` 代码块,返回代码体数组(保留原序)。
 *
 * 多块按文档顺序拼接 —— 用户可在思源里把长 typst 拆成多个代码块组织,
 * 物化时按出现顺序还原成单一 main.typ。
 */
export function extractTypstCodeBlocks(markdown: string): string[] {
    const blocks: string[] = [];
    let m: RegExpExecArray | null;
    TYPST_FENCE_RE.lastIndex = 0;
    while ((m = TYPST_FENCE_RE.exec(markdown)) !== null) {
        // 去掉代码体尾部多余空行,保留内部结构。
        blocks.push(m[1].replace(/\n+$/, "\n"));
    }
    return blocks;
}

/**
 * 轻量 markdown → typst 转换(降级模式)。
 *
 * 仅处理思源 markdown 里会干扰 typst 编译的杂质:
 * - 去行尾 IAL `{: id="..." updated="..." ...}`(思源块属性)。
 * - 去块引用脚注标记 `[^anchor]` 残留。
 *
 * 不做完整 md→typst 语义转换(标题/列表 typst 原生支持 markdown 风格有限,
 * 且通用转换复杂度高,超出本阶段范围)。复杂文档建议用 code-blocks 模式。
 */
export function markdownToTyp(markdown: string): string {
    return markdown
        // 去行尾 IAL: `{: id="202..."}`
        .replace(/[ \t]*\{:[^}]*\}[ \t]*$/gm, "")
        // 去思源块引用脚注定义残留: `[^202...]:`
        .replace(/^\[\^[^\]]+\]:.*$/gm, "")
        .trim();
}

/**
 * 把 typst 源写到插件 data 目录下临时子目录的 main.typ。
 *
 * 路径形如 `<pluginDataDir>/tinymist-tmp/<rand>/main.typ`。
 * 每次物化建独立子目录(随机名),避免并发/历史会话互相覆盖。
 * cleanup 删整个子目录。
 */
function writeTempEntry(typSource: string, pluginDataDir: string): MaterializedTyp {
    const fs = window.require("fs");
    const path = window.require("path");

    const rand = Math.random().toString(36).slice(2, 10);
    const rootDir = path.join(pluginDataDir, "tinymist-tmp", rand);
    const entryPath = path.join(rootDir, "main.typ");

    try {
        fs.mkdirSync(rootDir, { recursive: true });
        fs.writeFileSync(entryPath, typSource, "utf8");
    } catch (err) {
        throw new BlockToTypError(`failed to write temp main.typ: ${(err as Error).message}`);
    }

    let cleaned = false;
    const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        try {
            fs.rmSync(rootDir, { recursive: true, force: true });
        } catch (err) {
            console.warn(`[tinymist] cleanup failed for ${rootDir}:`, err);
        }
    };

    return { entryPath, rootDir, cleanup };
}

/** 文档无 typst 可用内容(code-blocks 模式无 typst 块 / markdown 模式空)。 */
export class NoTypstContentError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "NoTypstContentError";
    }
}

/** block → typ 物化通用错误。 */
export class BlockToTypError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "BlockToTypError";
    }
}
