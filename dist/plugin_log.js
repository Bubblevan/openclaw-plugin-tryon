const PREFIX = "[stablepay]";
let sink = null;
let debugEnabled = false;
/**
 * Call once from `register()` after `getPluginConfig`.
 * Debug logs: `pluginConfig.pluginDebug` or env `STABLEPAY_PLUGIN_DEBUG=1|true|yes`.
 */
export function initStablePayPluginLogging(apiLogger, cfg) {
    sink = apiLogger;
    const env = process.env.STABLEPAY_PLUGIN_DEBUG?.trim().toLowerCase();
    debugEnabled =
        Boolean(cfg.pluginDebug) || env === "1" || env === "true" || env === "yes";
}
export function isStablePayDebugEnabled() {
    return debugEnabled;
}
function line(msg, meta) {
    if (!meta || Object.keys(meta).length === 0)
        return msg;
    return `${msg} ${JSON.stringify(meta)}`;
}
/** Always routed to OpenClaw `api.logger` (plugin host log). */
export function stablePayInfo(msg, meta) {
    const s = `${PREFIX} ${line(msg, meta)}`;
    sink?.info(s);
}
export function stablePayWarn(msg, meta) {
    const s = `${PREFIX} ${line(msg, meta)}`;
    sink?.warn(s);
}
/**
 * Verbose: SPL ATAs, signing runtime, message sizes. Also mirrors to stderr when debug enabled
 * so you can grep the OpenClaw / Node process output if the host logger is noisy.
 */
export function stablePayDebug(msg, meta) {
    if (!debugEnabled)
        return;
    const s = `${PREFIX} [debug] ${line(msg, meta)}`;
    sink?.info(s);
    console.error(s);
}
