/**
 * 设置页(TODO.md §4 落点 `src/settings/index.ts`)。
 *
 * 经模板自带的 `src/libs/setting-utils.ts`(frostime SettingUtils)注册设置项,
 * 思源"设置 → 插件"里自动渲染。设置落 `<pluginData>/settings.json`,经
 * `SettingUtils.load/save` 持久化。
 *
 * 项:
 * - `tinymistPath` (textinput):tinymist 二进制绝对路径,空=用 PATH 的 `tinymist`。
 * - `dataPlaneHost` (textinput):preview 数据面绑定地址,默认 `127.0.0.1:0`(随机端口)。
 * - `materializeMode` (select):物化模式 `code-blocks` | `markdown`,默认 `code-blocks`。
 * - `extraArgs` (textinput):透传 tinymist 额外 CLI 参数(空格分隔,如 `--invert-colors=auto`)。
 *
 * 设置变更经 `onChange` 回调实时通知 plugin(plugin 更新 manager/resolver 配置)。
 * 注意:tinymistPath/dataPlaneHost 改动需重启 preview 会话才生效(下次 openPreview 时生效)。
 */

import { Plugin } from "siyuan";
import { SettingUtils } from "../libs/setting-utils";
import type { MaterializeMode } from "../mapper/block-to-typ";

/** 设置项 key。 */
export const SETTING_KEYS = {
    tinymistPath: "tinymistPath",
    dataPlaneHost: "dataPlaneHost",
    materializeMode: "materializeMode",
    extraArgs: "extraArgs",
} as const;

/** 设置存储名(`SettingUtils` 文件名 + `plugin.data[ name ]` key)。 */
const STORAGE_NAME = "settings";

/** 默认设置。 */
export const DEFAULT_SETTINGS: PluginSettings = {
    tinymistPath: "tinymist",
    dataPlaneHost: "127.0.0.1:0",
    materializeMode: "code-blocks",
    extraArgs: "",
};

/** 设置 shape。 */
export interface PluginSettings {
    /** tinymist 二进制路径;空串=PATH 查找。 */
    tinymistPath: string;
    /** preview 数据面绑定 `host:port`;`127.0.0.1:0`=随机端口。 */
    dataPlaneHost: string;
    /** 物化模式。 */
    materializeMode: MaterializeMode;
    /** 透传 tinymist 额外 CLI 参数(空格分隔)。 */
    extraArgs: string;
}

/** 设置变更回调,plugin 注册以更新 manager/resolver 配置。 */
export type SettingsChangeCallback = (settings: PluginSettings) => void;

/**
 * 初始化设置页。
 *
 * @param plugin Plugin 实例(SettingUtils 会绑 `plugin.setting`)。
 * @param i18n 插件 i18n 对象,取设置项文案。
 * @param onChange 任一设置项变更时回调(实时;`takeAndSave` 已落盘)。
 * @returns SettingUtils 实例;plugin 持有供后续 `get` 读值。
 */
export async function setupSettings(
    plugin: Plugin,
    i18n: any,
    onChange: SettingsChangeCallback,
): Promise<SettingUtils> {
    const utils = new SettingUtils({ plugin, name: STORAGE_NAME });

    const s = i18n?.setting ?? {};

    utils.addItem({
        key: SETTING_KEYS.tinymistPath,
        value: DEFAULT_SETTINGS.tinymistPath,
        type: "textinput",
        title: s.tinymistPath ?? "tinymist executable path",
        description: s.tinymistPathDesc ?? "Path to the tinymist binary. Leave as 'tinymist' to use PATH.",
        action: { callback: () => emitChange(utils, onChange) },
    });

    utils.addItem({
        key: SETTING_KEYS.dataPlaneHost,
        value: DEFAULT_SETTINGS.dataPlaneHost,
        type: "textinput",
        title: s.previewPort ?? "Preview server host:port",
        description: s.previewPortDesc ?? "Data-plane bind address. Use 127.0.0.1:0 for a random port.",
        action: { callback: () => emitChange(utils, onChange) },
    });

    utils.addItem({
        key: SETTING_KEYS.materializeMode,
        value: DEFAULT_SETTINGS.materializeMode,
        type: "select",
        title: s.materializeMode ?? "Materialize mode",
        description: s.materializeModeDesc ?? "How SiYuan doc becomes main.typ. code-blocks: extract ```typst blocks; markdown: light md→typst.",
        options: {
            [code_blocks_label(s)]: "code-blocks",
            [markdown_label(s)]: "markdown",
        },
        action: { callback: () => emitChange(utils, onChange) },
    });

    utils.addItem({
        key: SETTING_KEYS.extraArgs,
        value: DEFAULT_SETTINGS.extraArgs,
        type: "textinput",
        title: s.extraArgs ?? "Extra tinymist CLI args",
        description: s.extraArgsDesc ?? "Space-separated extra args passed to `tinymist preview` (e.g. --invert-colors=auto).",
        action: { callback: () => emitChange(utils, onChange) },
    });

    await utils.load();

    // 首次加载也通知一次,让 plugin 用持久化值初始化 manager/resolver。
    emitChange(utils, onChange);

    return utils;
}

/** 读取当前生效设置(合并默认值;元素未就绪时取 settings map 值)。 */
export function readSettings(utils: SettingUtils): PluginSettings {
    return {
        tinymistPath: String(utils.get(SETTING_KEYS.tinymistPath) ?? DEFAULT_SETTINGS.tinymistPath),
        dataPlaneHost: String(utils.get(SETTING_KEYS.dataPlaneHost) ?? DEFAULT_SETTINGS.dataPlaneHost),
        materializeMode: (utils.get(SETTING_KEYS.materializeMode) ?? DEFAULT_SETTINGS.materializeMode) as MaterializeMode,
        extraArgs: String(utils.get(SETTING_KEYS.extraArgs) ?? DEFAULT_SETTINGS.extraArgs),
    };
}

/** 读元素实时值并落盘,然后回调。 */
async function emitChange(utils: SettingUtils, onChange: SettingsChangeCallback): Promise<void> {
    // take 触发 updateValueFromElement;但 select/textinput 的元素可能未挂(设置页未开)。
    // 退化:直接读 settings map 值(action.callback 触发时元素已 onchange 更新过 value?否)。
    // SettingUtils 的 onchange 只绑元素回调,不自动写回 item.value —— 需 take(take=true)。
    for (const key of Object.values(SETTING_KEYS)) {
        utils.take(key, true);
    }
    await utils.save();
    onChange(readSettings(utils));
}

// select options 的 label 取 i18n,带 fallback。
function code_blocks_label(s: any): string {
    return s?.modeCodeBlocks ?? "code-blocks";
}
function markdown_label(s: any): string {
    return s?.modeMarkdown ?? "markdown";
}
