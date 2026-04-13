import { createHash } from "node:crypto";
/** SHA256(hex) of empty body — matches api-gateway auth.BodySHA256 for GET. */
export function gatewayEmptyBodySha256Hex() {
    return createHash("sha256").update("", "utf8").digest("hex");
}
/**
 * Canonical string for DID auth (v0.1), aligned with api-gateway auth.BuildCanonicalV01.
 * @param rawQuery - literal query string without leading `?` (e.g. `agent_did=did%3Asolana%3A...`)
 */
export function buildGatewayCanonicalV01(method, path, rawQuery, bodySha256Hex) {
    return [method, path, rawQuery, bodySha256Hex].join("\n");
}
/**
 * Headers for api-gateway AuthDID middleware: signs canonical + timestamp + nonce (append_timestamp_nonce).
 */
export async function buildGatewayDidAuthHeaders(runtime, agentDid, method, path, rawQuery) {
    const canonical = buildGatewayCanonicalV01(method, path, rawQuery, gatewayEmptyBodySha256Hex());
    const gatewayTimestamp = new Date().toISOString();
    const gatewayNonce = `gw-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    const gatewaySignature = await runtime.signMessage({
        message: canonical,
        chain: "solana",
        timestamp: gatewayTimestamp,
        nonce: gatewayNonce,
        append_timestamp_nonce: true,
    });
    return {
        "X-StablePay-DID": agentDid,
        "X-StablePay-Signature": gatewaySignature.signature,
        "X-StablePay-Timestamp": gatewayTimestamp,
        "X-StablePay-Nonce": gatewayNonce,
    };
}
