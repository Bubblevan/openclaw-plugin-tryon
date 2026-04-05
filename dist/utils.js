import crypto from "node:crypto";
export function generateMockWalletAddress() {
    return crypto.randomBytes(32).toString("hex").slice(0, 44);
}
export function generateMockDid(walletAddress) {
    return `did:solana:${walletAddress}`;
}
export function extractHandleFromTweetUrl(tweetUrl) {
    try {
        const url = new URL(tweetUrl);
        const parts = url.pathname.split("/").filter(Boolean);
        return parts[0] ?? "unknown";
    }
    catch {
        return "unknown";
    }
}
export function formatJson(value) {
    return JSON.stringify(value, null, 2);
}
export function buildVerifyLink(baseUrl, did) {
    const url = new URL(baseUrl);
    url.searchParams.set("did", did);
    return url.toString();
}
