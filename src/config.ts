import type { PluginConfig } from "./types.js";

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_REWARD_AMOUNT = 1;

export function getPluginConfig(api: any): Required<PluginConfig> {
  const raw = (api?.pluginConfig ?? {}) as PluginConfig;
  const backendBaseUrl = normalizeBaseUrl(raw.backendBaseUrl || "http://127.0.0.1:8080");
  const verifyPageBaseUrl = raw.verifyPageBaseUrl
    ? normalizeLooseUrl(raw.verifyPageBaseUrl)
    : `${backendBaseUrl}/verify`;

  return {
    backendBaseUrl,
    verifyPageBaseUrl,
    requestTimeoutMs: raw.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    rewardAmount: raw.rewardAmount ?? DEFAULT_REWARD_AMOUNT,
  };
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeLooseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}
