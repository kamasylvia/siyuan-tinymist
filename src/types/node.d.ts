/**
 * Electron renderer Node-integration ambient declarations.
 *
 * 思源桌面端以 `nodeIntegration:true` + `contextIsolation:false` +
 * `webSecurity:false` 启动 Electron(`app/electron/main.js:899-902`),
 * 插件代码运行在 renderer 进程,可经 `window.require` 拿到完整 Node
 * API。移动/浏览器/Docker 端编译时裁掉 `window.require`(`#if !BROWSER`),
 * 因此此处声明仅供桌面端使用 —— 调用方必须先经 `getFrontend()` 守卫。
 *
 * 仅声明 siyuan-tinymist 实际用到的子集,不引入 `@types/node` 全量类型
 * (避免 renderer 环境与 Node 主进程语义混淆)。
 */

declare global {
    interface Window {
        require(module: "child_process"): typeof import("child_process");
        require(module: "path"): typeof import("path");
        require(module: "fs"): typeof import("fs");
        require(module: string): any;
    }
}

// child_process 子集声明(manager.ts 用到)
declare module "child_process" {
    export interface ChildProcess {
        pid?: number;
        stdout: NodeJS.ReadableStream | null;
        stderr: NodeJS.ReadableStream | null;
        killed: boolean;
        kill(signal?: string): boolean;
        on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
        on(event: "error", listener: (err: Error) => void): this;
        on(event: string, listener: (...args: any[]) => void): this;
        removeListener(event: string, listener: (...args: any[]) => void): this;
    }

    export interface SpawnOptions {
        cwd?: string;
        env?: NodeJS.ProcessEnv;
        stdio?: "pipe" | "ignore" | "inherit" | Array<"pipe" | "ignore" | "inherit">;
        windowsHide?: boolean;
        detached?: boolean;
    }

    export function spawn(command: string, args?: ReadonlyArray<string>, options?: SpawnOptions): ChildProcess;
}

export {};
