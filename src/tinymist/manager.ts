/**
 * tinymist 子进程生命周期管理。
 *
 * 职责(TODO.md §4 落点 `src/tinymist/manager.ts`):
 * - spawn `tinymist preview <entry> --data-plane-host=127.0.0.1:0 --partial-rendering`
 * - 解析子进程 stdout/stderr,捕获 tinymist 打印的实际 preview server 地址:
 *     `Data plane server listening on: 127.0.0.1:<port>`
 *     `Static file server listening on: 127.0.0.1:<port>`
 *   静态文件服务地址即 preview 前端页(reflexo WASM),供 preview tab iframe 嵌入。
 * - 提供 start/stop/isRunning/getPreviewUrl;`stop()` 显式 kill,防僵尸进程
 *   (TODO.md §6「tinymist 进程随插件卸载/思源退出正确清理」)。
 *
 * 设计依据:
 * - 思源桌面端 `nodeIntegration:true`,插件可 `window.require('child_process').spawn`
 *   (TODO.md §0「思源插件 = Electron renderer 全权 Node 公民」)。
 * - tinymist preview CLI 输出格式见源码 `crates/tinymist-cli/src/cmd/preview.rs`
 *   (`log::info!("Static file server listening on: {addr}")`)。
 * - 仅桌面端调用;移动/浏览器端 `window.require` 被裁掉,调用方须先守卫。
 */

/** tinymist 进程管理器配置。 */
export interface TinymistManagerOptions {
    /** tinymist 可执行文件路径。空串=用 PATH 里的 `tinymist`。 */
    binaryPath?: string;
    /** preview 数据面绑定地址,`127.0.0.1:0` = 随机端口(默认)。 */
    dataPlaneHost?: string;
    /** 额外 CLI 参数透传(如 `--invert-colors=auto`)。 */
    extraArgs?: string[];
}

/** preview 会话句柄。 */
export interface PreviewSession {
    /** tinymist 报告的静态前端页地址(`http://127.0.0.1:<port>`),iframe src 用。 */
    previewUrl: string;
    /** tinymist 报告的 WebSocket data plane 地址(`127.0.0.1:<port>`)。 */
    dataPlaneHost: string;
    /** 子进程 PID。 */
    pid: number;
}

/** tinymist preview 地址正则。容忍 log 行可能带时间戳/级别前缀。 */
const STATIC_SERVER_RE = /Static file server listening on:\s*(\S+)/;
const DATA_PLANE_RE = /Data plane server listening on:\s*(\S+)/;

/**
 * tinymist 子进程管理器。
 *
 * 单实例语义:一个 manager 对应至多一个 running preview 会话。
 * `start()` 重复调用会先 stop 旧会话再起新的。
 */
export class TinymistManager {
    private child: import("child_process").ChildProcess | null = null;
    private session: PreviewSession | null = null;
    private readonly opts: Required<TinymistManagerOptions>;

    constructor(opts: TinymistManagerOptions = {}) {
        this.opts = {
            binaryPath: opts.binaryPath ?? "tinymist",
            dataPlaneHost: opts.dataPlaneHost ?? "127.0.0.1:0",
            extraArgs: opts.extraArgs ?? [],
        };
    }

    /** 是否有 tinymist 进程在跑。 */
    isRunning(): boolean {
        return this.child !== null && !this.child.killed;
    }

    /** 当前 preview 会话;未就绪返回 null。 */
    getSession(): PreviewSession | null {
        return this.session;
    }

    /**
     * 启动 tinymist preview,解析 stdout 拿到 preview URL 后 resolve。
     *
     * @param entryFile Typst 入口文件绝对路径(`main.typ`)。
     * @param rootDir  Typst 项目根目录(`#import` 相对路径锚点);默认取入口父目录。
     * @param timeoutMs 等 preview server 就绪的超时(默认 15s)。
     * @throws tinymist 二进制缺失 / spawn 失败 / 超时未拿到 preview URL。
     */
    async start(entryFile: string, rootDir?: string, timeoutMs = 15000): Promise<PreviewSession> {
        // 先收掉旧会话,保证单实例。
        if (this.isRunning()) {
            this.stop();
        }

        const cp = window.require("child_process");
        const args = [
            "preview",
            entryFile,
            "--data-plane-host=" + this.opts.dataPlaneHost,
            "--partial-rendering",
            ...this.opts.extraArgs,
        ];

        let child: import("child_process").ChildProcess;
        try {
            child = cp.spawn(this.opts.binaryPath, args, {
                cwd: rootDir,
                stdio: ["ignore", "pipe", "pipe"],
                windowsHide: true,
            });
        } catch (err) {
            throw new TinymistSpawnError(
                `failed to spawn tinymist at "${this.opts.binaryPath}": ${(err as Error).message}`,
                err,
            );
        }

        this.child = child;

        // spawn 异步错误(如 ENOENT 二进制不存在)经 'error' 事件抛出。
        const spawnError = new Promise<never>((_, reject) => {
            child.on("error", (err: NodeJS.ErrnoException) => {
                reject(
                    err.code === "ENOENT"
                        ? new TinymistNotFoundError(this.opts.binaryPath)
                        : new TinymistSpawnError(`tinymist spawn error: ${err.message}`, err),
                );
            });
        });

        // 解析 stdout/stderr 抓 preview 地址。tinymist log 可能走 stderr。
        const ready = new Promise<PreviewSession>((resolve) => {
            const onChunk = (chunk: Buffer | string) => {
                const text = chunk.toString();
                console.debug(`[tinymist] ${text.trimEnd()}`);
                if (!this.session) {
                    const addrs = parsePreviewAddresses(text);
                    if (addrs) {
                        const session: PreviewSession = {
                            previewUrl: addrs.previewUrl,
                            dataPlaneHost: addrs.dataPlaneHost,
                            pid: child.pid ?? -1,
                        };
                        this.session = session;
                        resolve(session);
                    }
                }
            };
            child.stdout?.on("data", onChunk);
            child.stderr?.on("data", onChunk);
        });

        // 子进程提前退出也算失败。
        const exited = new Promise<never>((_, reject) => {
            child.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
                reject(
                    new TinymistExitedError(
                        `tinymist exited before preview ready (code=${code} signal=${signal})`,
                    ),
                );
            });
        });

        const timeout = new Promise<never>((_, reject) =>
            setTimeout(
                () => reject(new TinymistTimeoutError(`preview server not ready within ${timeoutMs}ms`)),
                timeoutMs,
            ),
        );

        // 任一 Promise 落定即返回。error/exit/timeout 先到则 throw;ready 先到则返回 session。
        try {
            return await Promise.race([ready, spawnError, exited, timeout]);
        } catch (err) {
            // 失败时清场,防半启动僵尸进程。
            this.stop();
            throw err;
        }
    }

    /** 停止 tinymist 子进程,清空会话。幂等。 */
    stop(): void {
        const child = this.child;
        this.child = null;
        this.session = null;
        if (child && !child.killed) {
            try {
                child.kill("SIGTERM");
            } catch (err) {
                console.warn(`[tinymist] failed to SIGTERM child:`, err);
            }
        }
    }
}

/** 从 tinymist log 文本解析 preview 地址对。 */
function parsePreviewAddresses(text: string): { previewUrl: string; dataPlaneHost: string } | null {
    const staticMatch = text.match(STATIC_SERVER_RE);
    const dataMatch = text.match(DATA_PLANE_RE);
    if (!staticMatch) {
        return null;
    }
    const staticHost = staticMatch[1];
    // 静态服务地址即 iframe 要嵌的前端页。
    const previewUrl = `http://${staticHost}`;
    // data plane 地址若未单独打印,退化为静态服务地址(二者默认同 host)。
    const dataPlaneHost = dataMatch ? dataMatch[1] : staticHost;
    return { previewUrl, dataPlaneHost };
}

/** tinymist 二进制未找到(ENOENT)。 */
export class TinymistNotFoundError extends Error {
    constructor(binaryPath: string) {
        super(
            `tinymist binary not found at "${binaryPath}". ` +
                `Install tinymist or set the correct path in plugin settings.`,
        );
        this.name = "TinymistNotFoundError";
    }
}

/** tinymist spawn 失败(非 ENOENT)。 */
export class TinymistSpawnError extends Error {
    constructor(message: string, public readonly cause?: unknown) {
        super(message);
        this.name = "TinymistSpawnError";
    }
}

/** tinymist 在 preview 就绪前退出。 */
export class TinymistExitedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "TinymistExitedError";
    }
}

/** preview server 在超时内未就绪。 */
export class TinymistTimeoutError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "TinymistTimeoutError";
    }
}
