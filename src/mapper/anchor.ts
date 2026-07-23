/**
 * 入口锚点 4 层解析(TODO.md §4 落点 `src/mapper/anchor.ts`)。
 *
 * `#import` 相对路径要锚到项目主文件。按优先级解析 Typst 入口:
 *
 * 1. **文档 IAL 提示**:文档块属性 `custom-typst-root: /abs/path/main.typ`
 *    → 以该绝对路径为入口,其父目录为 root。用户在文档属性面板手填。
 * 2. **会话手动 pin**:preview tab 工具栏 "Pin entry file",内存状态,
 *    跨文档保持。清 pin 后回退到下层。
 * 3. **自动探测**(占位,当前跳过):同目录 / 项目根有 `main.typ` → 用之。
 *    思源文档非文件系统文件,「同目录」语义弱,需接 asset 机制,后续阶段补。
 * 4. **单文件默认**:当前文档物化成 `main.typ`(见 `block-to-typ.ts`),
 *    root = 入口父目录。
 *
 * 解析返回 `EntryResolution`,含 entryFile/rootDir/source(哪层命中),
 * 供 `TinymistManager.start` 用;若命中层需要物化,附带 cleanup。
 *
 * 设计依据:
 * - IAL 读写:`/api/attr/getBlockAttrs`(`{id}` → `{[key]:string}`),
 *   `/api/attr/setBlockAttrs`(源码 `kernel/api/attr.go`)。`custom-*` 前缀
 *   即自定义属性。
 */

import { fetchSyncPost } from "siyuan";
import { materializeDocToTyp, MaterializedTyp, MaterializeMode } from "./block-to-typ";

/** IAL key:Typst 入口绝对路径提示。 */
export const IAL_TYPST_ROOT = "custom-typst-root";
/** IAL key:物化模式(`code-blocks` | `markdown`),仅单文件默认层用。 */
export const IAL_TYPST_MODE = "custom-typst-mode";

/** 命中的解析层。 */
export type AnchorSource = "ial" | "pin" | "auto" | "materialized";

/** 入口解析结果。 */
export interface EntryResolution {
    /** Typst 入口文件绝对路径。 */
    entryFile: string;
    /** 项目根目录(`#import` 锚点),入口父目录。 */
    rootDir: string;
    /** 命中层。 */
    source: AnchorSource;
    /** 物化产物 cleanup;仅 `source=materialized` 时非空,用完调。 */
    cleanup?: () => void;
}

/** 解析器状态(会话级 pin)。 */
export interface AnchorResolverOptions {
    /** 插件 data 目录,物化层临时产物落于此。 */
    pluginDataDir: string;
    /** 会话 pin 的入口路径(绝对);省略/null = 未 pin。 */
    pinnedEntry?: string | null;
}

/**
 * 入口锚点解析器。
 *
 * 持有会话级 pin 状态;`resolve(docId)` 按 4 层优先级解析入口。
 * pin 状态由 preview tab UI 经 `setPin`/`clearPin` 维护。
 */
export class AnchorResolver {
    private pinnedEntry: string | null = null;
    private readonly pluginDataDir: string;

    constructor(opts: AnchorResolverOptions) {
        this.pluginDataDir = opts.pluginDataDir;
        this.pinnedEntry = opts.pinnedEntry ?? null;
    }

    /** 设置会话 pin(绝对路径)。 */
    setPin(entryPath: string): void {
        this.pinnedEntry = entryPath;
    }

    /** 清除会话 pin。 */
    clearPin(): void {
        this.pinnedEntry = null;
    }

    /** 当前 pin;null = 未 pin。 */
    getPinned(): string | null {
        return this.pinnedEntry;
    }

    /**
     * 按优先级解析入口。
     *
     * @param docId 当前文档 rootID(IAL / 物化层用)。
     * @returns 解析结果。
     * @throws IAL/pin 路径不存在,或物化层无 typst 内容。
     */
    async resolve(docId: string): Promise<EntryResolution> {
        // 1. 文档 IAL custom-typst-root(绝对路径)。
        const ialEntry = await this.resolveFromIAL(docId);
        if (ialEntry) {
            return ialEntry;
        }

        // 2. 会话手动 pin。
        const pinEntry = this.resolveFromPin();
        if (pinEntry) {
            return pinEntry;
        }

        // 3. 自动探测(占位:思源文档无「同目录」文件语义,后续接 asset 补)。
        const autoEntry = await this.resolveAuto(docId);
        if (autoEntry) {
            return autoEntry;
        }

        // 4. 单文件默认:物化当前文档。
        return this.resolveMaterialized(docId);
    }

    /** 层 1:读文档 IAL `custom-typst-root`,校验路径存在则用。 */
    private async resolveFromIAL(docId: string): Promise<EntryResolution | null> {
        const attrs = await getBlockAttrs(docId);
        const root = attrs[IAL_TYPST_ROOT]?.trim();
        if (!root) {
            return null;
        }
        if (!pathExists(root)) {
            throw new AnchorError(
                `IAL ${IAL_TYPST_ROOT}="${root}" points to a non-existent file. ` +
                    `Update the document attribute or remove it.`,
            );
        }
        const path = window.require("path");
        return {
            entryFile: root,
            rootDir: path.dirname(root),
            source: "ial",
        };
    }

    /** 层 2:会话 pin。 */
    private resolveFromPin(): EntryResolution | null {
        if (!this.pinnedEntry) {
            return null;
        }
        if (!pathExists(this.pinnedEntry)) {
            // pin 路径失效,清掉并回退。
            console.warn(`[tinymist] pinned entry not found, clearing: ${this.pinnedEntry}`);
            this.pinnedEntry = null;
            return null;
        }
        const path = window.require("path");
        return {
            entryFile: this.pinnedEntry,
            rootDir: path.dirname(this.pinnedEntry),
            source: "pin",
        };
    }

    /** 层 3:自动探测(占位)。 */
    private async resolveAuto(_docId: string): Promise<EntryResolution | null> {
        // TODO(后续阶段):接思源 asset 机制,探测文档关联 asset 目录下的 main.typ。
        return null;
    }

    /** 层 4:物化当前文档。 */
    private async resolveMaterialized(docId: string): Promise<EntryResolution> {
        const attrs = await getBlockAttrs(docId);
        const modeAttr = attrs[IAL_TYPST_MODE]?.trim();
        const mode: MaterializeMode =
            modeAttr === "markdown" ? "markdown" : "code-blocks";

        const typ: MaterializedTyp = await materializeDocToTyp(docId, this.pluginDataDir, { mode });
        return {
            entryFile: typ.entryPath,
            rootDir: typ.rootDir,
            source: "materialized",
            cleanup: typ.cleanup,
        };
    }
}

/**
 * 读文档块属性(IAL)。
 *
 * `data` 形如 `{ id: "...", title: "...", "custom-typst-root": "..." }`。
 */
async function getBlockAttrs(docId: string): Promise<Record<string, string>> {
    const resp = await fetchSyncPost("/api/attr/getBlockAttrs", { id: docId });
    if (resp.code !== 0) {
        throw new AnchorError(`getBlockAttrs failed: ${resp.msg ?? "unknown"} (code=${resp.code})`);
    }
    return (resp.data ?? {}) as Record<string, string>;
}

/** 同步检查路径存在(fs.existsSync)。 */
function pathExists(p: string): boolean {
    try {
        return Boolean(window.require("fs").existsSync(p));
    } catch {
        return false;
    }
}

/** 设置文档 IAL(供 UI "Pin as project root" 写回文档属性用)。 */
export async function setBlockAttr(docId: string, key: string, value: string | null): Promise<void> {
    const resp = await fetchSyncPost("/api/attr/setBlockAttrs", {
        id: docId,
        attrs: { [key]: value },
    });
    if (resp.code !== 0) {
        throw new AnchorError(`setBlockAttrs failed: ${resp.msg ?? "unknown"} (code=${resp.code})`);
    }
}

/** 锚点解析错误。 */
export class AnchorError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "AnchorError";
    }
}
