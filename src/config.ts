import os from "node:os";
import path from "node:path";

import type { PluginConfig } from "./types.js";

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_REWARD_AMOUNT = 1;
const DEFAULT_STATE_FILE = path.join(os.homedir(), ".stablepay-openclaw", "stablepay-local-state.enc");
const DEFAULT_MASTER_KEY_ENV = "STABLEPAY_PLUGIN_MASTER_KEY";
const DEFAULT_OWS_PASSPHRASE_ENV = "STABLEPAY_OWS_PASSPHRASE";
const DEFAULT_WALLET_NAME_PREFIX = "stablepay";
const DEFAULT_DID_REGISTER_PATH = "/api/v1/did/register";

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
    localStatePath: raw.localStatePath ?? DEFAULT_STATE_FILE,
    localStateKeyEnv: raw.localStateKeyEnv ?? DEFAULT_MASTER_KEY_ENV,
    owsVaultPath: raw.owsVaultPath ?? "",
    owsPassphraseEnv: raw.owsPassphraseEnv ?? DEFAULT_OWS_PASSPHRASE_ENV,
    owsRuntime: raw.owsRuntime ?? "auto",
    walletNamePrefix: raw.walletNamePrefix ?? DEFAULT_WALLET_NAME_PREFIX,
    didRegisterPath: raw.didRegisterPath ?? DEFAULT_DID_REGISTER_PATH,
    allowLegacyDidCreateFallback: raw.allowLegacyDidCreateFallback ?? false,
  };
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeLooseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}
