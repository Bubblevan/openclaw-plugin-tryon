import os from "node:os";
import path from "node:path";
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_REWARD_AMOUNT = 1;
const DEFAULT_STATE_FILE = path.join(os.homedir(), ".stablepay-openclaw", "stablepay-local-state.enc");
const DEFAULT_MASTER_KEY_ENV = "STABLEPAY_PLUGIN_MASTER_KEY";
const DEFAULT_OWS_PASSPHRASE_ENV = "STABLEPAY_OWS_PASSPHRASE";
const DEFAULT_WALLET_NAME_PREFIX = "stablepay";
const DEFAULT_DID_REGISTER_PATH = "/api/v1/did";
const DEFAULT_OWS_REST_SIGN_PATH = "/v1/sign/message";
const DEFAULT_OWS_REST_API_KEY_ENV = "STABLEPAY_OWS_REST_API_KEY";
const DEFAULT_OWS_REST_CHAIN_ID = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
export function getPluginConfig(api) {
    const raw = (api?.pluginConfig ?? {});
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
        owsRestBaseUrl: raw.owsRestBaseUrl ? normalizeBaseUrl(raw.owsRestBaseUrl) : "",
        owsRestSignPath: raw.owsRestSignPath ?? DEFAULT_OWS_REST_SIGN_PATH,
        owsRestApiKeyEnv: raw.owsRestApiKeyEnv ?? DEFAULT_OWS_REST_API_KEY_ENV,
        owsRestAuthMode: raw.owsRestAuthMode ?? "bearer",
        owsRestWalletId: raw.owsRestWalletId ?? "",
        owsRestChainId: raw.owsRestChainId ?? DEFAULT_OWS_REST_CHAIN_ID,
    };
}
function normalizeBaseUrl(value) {
    return value.replace(/\/+$/, "");
}
function normalizeLooseUrl(value) {
    return value.replace(/\/+$/, "");
}
