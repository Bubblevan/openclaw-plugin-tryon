import { spawnSync } from "node:child_process";
function stripHexPrefix(v) {
    return v.startsWith("0x") ? v.slice(2) : v;
}
/**
 * Parse `ows sign message --json` stdout and return raw signature hex (no 0x).
 */
export function parseSignatureHexFromOwsJson(jsonText) {
    let parsed;
    try {
        parsed = JSON.parse(jsonText);
    }
    catch {
        throw new Error(`ows sign message: invalid JSON: ${jsonText.slice(0, 240)}`);
    }
    const keys = ["signature", "sig"];
    for (const k of keys) {
        const v = parsed[k];
        if (typeof v === "string" && v.trim()) {
            return stripHexPrefix(v.trim());
        }
    }
    throw new Error("ows sign message: JSON output missing signature field");
}
/**
 * Sign arbitrary message bytes (hex, no 0x) via OWS CLI.
 * Returns signature hex (64 bytes => 128 hex chars, no 0x).
 */
export function signMessageHexWithOwsCli(walletName, chain, messageHex) {
    const cleanHex = stripHexPrefix((messageHex || "").trim());
    if (!cleanHex) {
        throw new Error("ows sign message: empty message hex");
    }
    if (!/^[0-9a-fA-F]+$/.test(cleanHex)) {
        throw new Error("ows sign message: message hex contains non-hex characters");
    }
    const result = spawnSync("ows", ["sign", "message", "--wallet", walletName, "--chain", chain, "--encoding", "hex", "--message", cleanHex, "--json"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, env: process.env });
    const errText = (result.stderr || result.stdout || result.error?.message || "").trim();
    if (result.status !== 0) {
        throw new Error(`ows sign message failed (exit ${result.status}): ${errText || "no output"}`);
    }
    return parseSignatureHexFromOwsJson(result.stdout || "{}");
}
/**
 * Backward-compatible alias for current Solana flow:
 * sign the transaction MESSAGE bytes (not full serialized tx).
 */
export function signSolanaMessageHexWithOwsCli(walletName, messageHex) {
    return signMessageHexWithOwsCli(walletName, "solana", messageHex);
}
/**
 * Parse `ows sign tx --json` stdout and return the raw signed transaction as hex (no 0x).
 */
export function parseSignedTxHexFromOwsJson(jsonText) {
    let parsed;
    try {
        parsed = JSON.parse(jsonText);
    }
    catch {
        throw new Error(`ows sign tx: invalid JSON: ${jsonText.slice(0, 240)}`);
    }
    const keys = ["signed_tx", "signedTx", "tx", "transaction", "raw_tx", "rawTransaction"];
    for (const k of keys) {
        const v = parsed[k];
        if (typeof v === "string" && v.trim()) {
            let h = v.trim();
            if (h.startsWith("0x"))
                h = h.slice(2);
            return h;
        }
    }
    throw new Error("ows sign tx: JSON output missing signed transaction field");
}
/**
 * Sign a Solana transaction (hex, no 0x) via OWS CLI. Returns signed tx hex (no 0x).
 */
export function signTxWithOwsCli(walletName, chain, txHex) {
    const result = spawnSync("ows", ["sign", "tx", "--wallet", walletName, "--chain", chain, "--tx", txHex, "--json"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, env: process.env });
    const errText = (result.stderr || result.stdout || result.error?.message || "").trim();
    if (result.status !== 0) {
        throw new Error(`ows sign tx failed (exit ${result.status}): ${errText || "no output"}`);
    }
    return parseSignedTxHexFromOwsJson(result.stdout || "{}");
}
