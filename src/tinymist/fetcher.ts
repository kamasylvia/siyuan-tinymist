/**
 * tinymist 二进制获取(首次运行下载)。
 *
 * TODO.md §8「tinymist 二进制分发」决策:首次运行下载(对齐 VSCode tinymist 扩展)。
 *
 * 流程(`ensureTinymistBinary`):
 * 1. 若 settings.tinymistPath 非默认(`tinymist`)/用户填了绝对路径 → 直接用,不下载。
 * 2. PATH 有 `tinymist` → 用 PATH 的,不下载。
 * 3. 否则从 GitHub Release 按平台/架构下载预编译二进制到 `<pluginData>/bin/tinymist`,
 *    校验 SHA256(同 release 的 .sha256 文件),chmod +x(macOS/Linux),
 *    去 quarantine(macOS,`xattr -d com.apple.quarantine`)。
 *
 * 设计依据:
 * - 思源桌面端 `nodeIntegration:true`,可 `window.require('child_process')` /
 *   `window.require('https')` / `window.require('fs')`。
 * - Release 资产命名:`tinymist-<triple>.tar.gz`(macOS/Linux) /
 *   `tinymist-<triple>.zip`(windows),triple 见 PLATFORM_MAP。
 * - .sha256 文件格式:`<hash>  tinymist-<triple>.tar.gz`。
 */

import { getBackend } from "siyuan";

/** tinymist GitHub Release 资产命名 triple 映射。 */
const PLATFORM_MAP: Record<string, { arch: string; ext: "tar.gz" | "zip" }> = {
    "darwin-arm64": { arch: "aarch64-apple-darwin", ext: "tar.gz" },
    "darwin-x64": { arch: "x86_64-apple-darwin", ext: "tar.gz" },
    "linux-arm64": { arch: "aarch64-unknown-linux-gnu", ext: "tar.gz" },
    "linux-x64": { arch: "x86_64-unknown-linux-gnu", ext: "tar.gz" },
    "windows-x64": { arch: "x86_64-pc-windows-msvc", ext: "zip" },
};

/** tinymist Release 固定 tag(锁版本,避免上游 breaking)。升级时改此常量 + 测试。 */
export const TINYMIST_VERSION = "v0.15.2";
const RELEASE_BASE = `https://github.com/Myriad-Dreamin/tinymist/releases/download/${TINYMIST_VERSION}`;

/** 下载进度回调。 */
export type ProgressCallback = (downloaded: number, total: number) => void;

/** ensure 结果。 */
export interface EnsureResult {
    /** 最终用的二进制路径。 */
    binaryPath: string;
    /** 来源。 */
    source: "settings" | "path" | "downloaded" | "cached";
}

/**
 * 确保 tinymist 二进制可用,返回其路径。
 *
 * @param settingsPath settings.tinymistPath 值(默认 `tinymist` = 用 PATH/下载)。
 * @param pluginDataDir 插件 data 目录,下载产物落 `<dir>/bin/`。
 * @param onProgress 下载进度回调(可选)。
 * @throws 平台不支持 / 下载失败 / SHA256 校验失败 / 解压失败。
 */
export async function ensureTinymistBinary(
    settingsPath: string,
    pluginDataDir: string,
    onProgress?: ProgressCallback,
): Promise<EnsureResult> {
    // 1. 用户在设置填了非默认路径 → 信任用户,直接用。
    if (settingsPath && settingsPath !== "tinymist") {
        return { binaryPath: settingsPath, source: "settings" };
    }

    // 2. PATH 有 tinymist → 用 PATH 的。
    const pathBin = findInPath("tinymist");
    if (pathBin) {
        return { binaryPath: pathBin, source: "path" };
    }

    // 3. 已下载过(cached)→ 直接用。
    const destDir = joinPath(pluginDataDir, "bin");
    const destBin = joinPath(destDir, process.platform === "win32" ? "tinymist.exe" : "tinymist");
    if (fileExists(destBin)) {
        return { binaryPath: destBin, source: "cached" };
    }

    // 4. 下载。
    const platform = detectPlatform();
    const spec = PLATFORM_MAP[platform];
    if (!spec) {
        throw new FetchError(
            `unsupported platform "${platform}". Install tinymist manually and set its path in settings.`,
        );
    }

    const assetName = `tinymist-${spec.arch}.${spec.ext}`;
    const assetUrl = `${RELEASE_BASE}/${assetName}`;
    const shaUrl = `${RELEASE_BASE}/${assetName}.sha256`;

    mkdirp(destDir);

    // 下载 + 校验。
    const archivePath = joinPath(destDir, assetName);
    await downloadFile(assetUrl, archivePath, onProgress);

    const expectedSha = (await fetchText(shaUrl)).split(/\s+/)[0].trim();
    const actualSha = await sha256File(archivePath);
    if (expectedSha.toLowerCase() !== actualSha.toLowerCase()) {
        safeRemove(archivePath);
        throw new FetchError(
            `SHA256 mismatch for ${assetName}: expected ${expectedSha}, got ${actualSha}.`,
        );
    }

    // 解压 → 找 tinymist 二进制(tar/zip 内可能有顶层目录,如 `tinymist-<triple>/tinymist`)。
    extractArchive(archivePath, destDir, spec.ext);
    safeRemove(archivePath);

    const extracted = findExtractedBinary(destDir);
    if (!extracted) {
        throw new FetchError(`archive extracted but tinymist binary not found under ${destDir}.`);
    }

    // 移到标准 destBin 位置(扁平化,避免每次 resolve 嵌套路径)。
    if (extracted !== destBin) {
        moveFile(extracted, destBin);
        // 清理空壳目录(如 tinymist-<triple>/)。
        pruneEmptyDirs(destDir);
    }

    chmodExec(destBin);
    stripQuarantine(destBin);

    return { binaryPath: destBin, source: "downloaded" };
}

/** 在 destDir 下递归找 tinymist 二进制(容忍 `tinymist-<triple>/tinymist` 结构)。 */
function findExtractedBinary(destDir: string): string | null {
    const fs = window.require("fs");
    const path = window.require("path");
    const binName = process.platform === "win32" ? "tinymist.exe" : "tinymist";
    const walk = (dir: string): string | null => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                const found = walk(full);
                if (found) return found;
            } else if (entry.isFile() && entry.name === binName) {
                return full;
            }
        }
        return null;
    };
    return walk(destDir);
}

function moveFile(src: string, dest: string): void {
    const fs = window.require("fs");
    fs.renameSync(src, dest);
}

function pruneEmptyDirs(root: string): void {
    const fs = window.require("fs");
    const path = window.require("path");
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            const full = path.join(root, entry.name);
            try {
                fs.rmSync(full, { recursive: true });
            } catch {
                /* ignore */
            }
        }
    }
}

/** 检测当前平台 key(PLATFORM_MAP 的 key)。 */
function detectPlatform(): string {
    const backend = getBackend(); // windows|linux|darwin|docker|...
    const os = backend === "docker" ? process.platform : backend;
    const arch = process.arch; // arm64|x64
    const archKey = arch === "arm64" ? "arm64" : "x64";
    return `${os}-${archKey}`;
}

/** PATH 查找二进制(which)。 */
function findInPath(bin: string): string | null {
    const cp = window.require("child_process");
    const fs = window.require("fs");
    const path = window.require("path");
    // 优先用 which/where,失败则遍历 PATH。
    try {
        const cmd = process.platform === "win32" ? "where" : "which";
        const loc = cp.spawnSync(cmd, [bin]).stdout?.toString().trim().split(/\r?\n/)[0];
        if (loc && fs.existsSync(loc)) {
            return loc;
        }
    } catch {
        /* fall through */
    }
    const PATH = process.env.PATH || process.env.Path || "";
    const ext = process.platform === "win32" ? [".exe", ""] : [""];
    for (const dir of PATH.split(path.delimiter)) {
        for (const e of ext) {
            const p = path.join(dir, bin + e);
            if (safeExists(p)) {
                return p;
            }
        }
    }
    return null;
}

// --- 文件/网络原语(经 window.require 拿 node 模块,桌面端可用) ---

function joinPath(...segs: string[]): string {
    return window.require("path").join(...segs);
}
function fileExists(p: string): boolean {
    try {
        return window.require("fs").existsSync(p);
    } catch {
        return false;
    }
}
function safeExists(p: string): boolean {
    try {
        const fs = window.require("fs");
        fs.accessSync(p);
        return true;
    } catch {
        return false;
    }
}
function mkdirp(p: string): void {
    window.require("fs").mkdirSync(p, { recursive: true });
}
function safeRemove(p: string): void {
    try {
        window.require("fs").rmSync(p, { force: true });
    } catch {
        /* ignore */
    }
}
function chmodExec(p: string): void {
    if (process.platform === "win32") return;
    try {
        window.require("fs").chmodSync(p, 0o755);
    } catch {
        /* ignore */
    }
}
function stripQuarantine(p: string): void {
    if (process.platform !== "darwin") return;
    try {
        window.require("child_process").spawnSync("xattr", ["-d", "com.apple.quarantine", p]);
    } catch {
        /* non-fatal */
    }
}

/** 下载文件(https.get,带进度)。 */
function downloadFile(url: string, dest: string, onProgress?: ProgressCallback): Promise<void> {
    return new Promise((resolve, reject) => {
        const https = window.require("https");
        const fs = window.require("fs");
        const file = fs.createWriteStream(dest);
        const req = https.get(url, (res: any) => {
            // 处理重定向(GitHub Release 302 到 CDN)。
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                file.close();
                safeRemove(dest);
                downloadFile(res.headers.location, dest, onProgress).then(resolve, reject);
                return;
            }
            if (res.statusCode !== 200) {
                file.close();
                safeRemove(dest);
                reject(new FetchError(`download ${url} failed: HTTP ${res.statusCode}`));
                return;
            }
            const total = parseInt(res.headers["content-length"] || "0", 10);
            let downloaded = 0;
            res.on("data", (chunk: Buffer) => {
                downloaded += chunk.length;
                onProgress?.(downloaded, total);
            });
            res.pipe(file);
            file.on("finish", () => file.close(() => resolve()));
        });
        req.on("error", (err: Error) => {
            file.close();
            safeRemove(dest);
            reject(new FetchError(`download ${url} failed: ${err.message}`, err));
        });
    });
}

/** 取 URL 文本(小文件,如 .sha256)。 */
function fetchText(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const https = window.require("https");
        https.get(url, (res: any) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                fetchText(res.headers.location).then(resolve, reject);
                return;
            }
            if (res.statusCode !== 200) {
                reject(new FetchError(`fetch ${url} failed: HTTP ${res.statusCode}`));
                return;
            }
            let data = "";
            res.on("data", (c: Buffer) => (data += c.toString()));
            res.on("end", () => resolve(data));
        }).on("error", (err: Error) => reject(new FetchError(`fetch ${url} failed: ${err.message}`, err)));
    });
}

/** SHA256 文件校验。 */
function sha256File(p: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const crypto = window.require("crypto");
        const fs = window.require("fs");
        const h = crypto.createHash("sha256");
        const s = fs.createReadStream(p);
        s.on("data", (c: Buffer) => h.update(c));
        s.on("end", () => resolve(h.digest("hex")));
        s.on("error", reject);
    });
}

/** 解压 tar.gz / zip。 */
function extractArchive(archivePath: string, destDir: string, ext: "tar.gz" | "zip"): void {
    const cp = window.require("child_process");
    if (ext === "tar.gz") {
        // tar -xzf <archive> -C <destDir>
        cp.spawnSync("tar", ["-xzf", archivePath, "-C", destDir]);
    } else {
        // zip:优先 unzip,fallback PowerShell(Windows 自带)
        const r = cp.spawnSync("unzip", ["-o", archivePath, "-d", destDir]);
        if (r.status !== 0 && process.platform === "win32") {
            cp.spawnSync("powershell", ["-Command", `Expand-Archive -Path '${archivePath}' -DestinationPath '${destDir}' -Force`]);
        }
    }
}

/** fetcher 错误。 */
export class FetchError extends Error {
    constructor(message: string, public readonly cause?: unknown) {
        super(message);
        this.name = "FetchError";
    }
}
