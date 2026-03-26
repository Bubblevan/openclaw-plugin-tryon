import crypto from "node:crypto";

export function generateMockWalletAddress(): string {
  return crypto.randomBytes(32).toString("hex").slice(0, 44);
}

export function generateMockDid(walletAddress: string): string {
  return `did:solana:${walletAddress}`;
}

export function extractHandleFromTweetUrl(tweetUrl: string): string {
  try {
    const url = new URL(tweetUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    return parts[0] ?? "unknown";
  } catch {
    return "unknown";
  }
}

export function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function buildVerifyLink(baseUrl: string, did: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("did", did);
  return url.toString();
}
