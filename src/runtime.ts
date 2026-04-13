import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { verifySolanaWalletMessageUtf8 } from "./bind_verify.js";
import { signSolanaMessageHexWithOwsCli } from "./ows_sign_tx.js";
import { stablePayDebug } from "./plugin_log.js";

import type {
  BindExistingWalletParams,
  BuildPaymentPolicyParams,
  ConfigurePaymentLimitsParams,
  CreateLocalWalletParams,
  DIDRecord,
  PluginConfig,
  RuntimeDriver,
  SignMessageParams,
  WalletProviderName,
} from "./types.js";

type WalletState = {
  walletId: string;
  walletName: string;
  did: string;
  publicKey: string;
  walletAddress: string;
  runtimeDriver: Exclude<RuntimeDriver, "auto">;
  provider: WalletProviderName;
  createdAt: string;
  backendDid?: DIDRecord;
};

type PaymentConfigState = {
  singlePurchaseLimitUsdc: number;
  autoPurchaseThresholdUsdc: number;
  currency: "USDC" | "USDT";
  updatedAt: string;
};

type PolicyState = {
  policyId: string;
  walletId: string;
  ownerOrAgent: "owner" | "agent";
  policyPath: string;
  manifest: Record<string, unknown>;
  createdAt: string;
  recipientWallet?: string;
  skillDid?: string;
  purpose: string;
  currency: "USDC" | "USDT";
  expiresAt?: string;
};

type ApiKeyState = {
  apiKeyIdMasked: string;
  ownerOrAgent: "owner" | "agent";
  createdAt: string;
};

type LocalPluginState = {
  version: 1;
  wallet?: WalletState;
  paymentConfig?: PaymentConfigState;
  policy?: PolicyState;
  apiKey?: ApiKeyState;
};

type OwsSdkModule = {
  createWallet: (
    name: string,
    passphrase?: string | null,
    words?: number | null,
    vaultPathOpt?: string | null,
  ) => {
    id: string;
    name: string;
    accounts: Array<{ chainId: string; address: string; derivationPath: string }>;
    createdAt: string;
  };
  getWallet: (nameOrId: string, vaultPathOpt?: string | null) => {
    id: string;
    name: string;
    accounts: Array<{ chainId: string; address: string; derivationPath: string }>;
    createdAt: string;
  };
  signMessage: (
    wallet: string,
    chain: string,
    message: string,
    passphrase?: string | null,
    encoding?: string | null,
    index?: number | null,
    vaultPathOpt?: string | null,
  ) => { signature: string };
};

type RuntimeAvailability = {
  requestedDriver: RuntimeDriver;
  activeDriver: Exclude<RuntimeDriver, "auto">;
  availableDrivers: Exclude<RuntimeDriver, "auto">[];
  notes: string[];
};

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

interface WalletProvider {
  readonly name: WalletProviderName;
  createWallet(
    walletName: string,
    params: CreateLocalWalletParams,
    activeDriver: Exclude<RuntimeDriver, "auto">,
  ): Promise<WalletState>;
  signMessage(state: WalletState, params: SignMessageParams): Promise<string>;
}

export class StablePayRuntime {
  private readonly owsProvider: WalletProvider;

  constructor(private readonly cfg: Required<PluginConfig>) {
    this.owsProvider = new OwsWalletProvider(this);
  }

  async getStatus() {
    const availability = await this.detectAvailability();
    const state = await this.loadState();

    return {
      requested_driver: availability.requestedDriver,
      active_driver: availability.activeDriver,
      available_drivers: availability.availableDrivers,
      local_state_path: this.cfg.localStatePath,
      has_wallet: Boolean(state.wallet),
      wallet: state.wallet
        ? {
            wallet_id: state.wallet.walletId,
            wallet_name: state.wallet.walletName,
            did: state.wallet.did,
            wallet_address: state.wallet.walletAddress,
            runtime_driver: state.wallet.runtimeDriver,
            backend_did: state.wallet.backendDid?.did || "",
          }
        : null,
      payment_config: state.paymentConfig ?? null,
      policy: state.policy
        ? {
            policy_id: state.policy.policyId,
            policy_path: state.policy.policyPath,
            owner_or_agent: state.policy.ownerOrAgent,
            currency: state.policy.currency,
            purpose: state.policy.purpose,
          }
        : null,
      notes: availability.notes,
    };
  }

  async createLocalWallet(params: CreateLocalWalletParams) {
    const state = await this.loadState();
    const availability = await this.detectAvailability(params.runtime);
    const walletName = buildWalletName(this.cfg.walletNamePrefix, params.user_id, params.wallet_name);

    const provider = this.providerForDriver(availability.activeDriver);
    const wallet = await provider.createWallet(walletName, params, availability.activeDriver);

    state.wallet = wallet;
    await this.saveState(state);

    return {
      runtime_driver: availability.activeDriver,
      wallet_id: wallet.walletId,
      wallet_name: wallet.walletName,
      did: wallet.did,
      public_key: wallet.publicKey,
      wallet_address: wallet.walletAddress,
      created_at: wallet.createdAt,
      notes: availability.notes,
    };
  }

  /**
   * Bind an existing OWS wallet (by name) to local encrypted state — no createWallet.
   * Signs a random challenge and verifies Ed25519 against `public_key` before persisting.
   */
  async bindExistingWallet(params: BindExistingWalletParams) {
    const walletName = params.wallet_name.trim();
    const publicKeyExpected = params.public_key.trim();
    if (!walletName) throw new Error("wallet_name is required");
    if (!publicKeyExpected) throw new Error("public_key is required");

    const rawRuntime = params.runtime ?? this.cfg.owsRuntime;
    const availability = await this.detectAvailability(
      rawRuntime === "auto" ? undefined : (rawRuntime as Exclude<RuntimeDriver, "auto">),
    );
    const activeDriver = availability.activeDriver;

    let wallet: WalletState;

    if (activeDriver === "ows-sdk") {
      const ows = await this.tryLoadOwsSdk();
      if (!ows) throw new Error("OWS SDK runtime is not available in the current environment");
      let info: ReturnType<OwsSdkModule["getWallet"]>;
      try {
        info = ows.getWallet(walletName, this.cfg.owsVaultPath || undefined);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`OWS getWallet("${walletName}") failed: ${msg}`);
      }
      const sol = info.accounts.find((a) => a.chainId.toLowerCase().includes("solana"));
      if (!sol) throw new Error("OWS wallet does not expose a Solana account");
      if (sol.address !== publicKeyExpected) {
        throw new Error(
          `public_key mismatch: expected vault Solana address ${sol.address} for wallet "${walletName}", got ${publicKeyExpected}`,
        );
      }
      wallet = {
        walletId: info.id,
        walletName: info.name,
        did: `did:solana:${sol.address}`,
        publicKey: sol.address,
        walletAddress: sol.address,
        runtimeDriver: "ows-sdk",
        provider: "ows",
        createdAt: info.createdAt || new Date().toISOString(),
      };
    } else if (activeDriver === "ows-cli" || activeDriver === "wsl-ows") {
      wallet = this.createOwsCliLinkedWallet(walletName, publicKeyExpected, activeDriver);
    } else if (activeDriver === "ows-rest") {
      const cfg = this.cfg;
      const wid = (params.ows_wallet_id?.trim() || cfg.owsRestWalletId || "").trim();
      if (!wid) {
        throw new Error("ows_wallet_id is required for ows-rest (or set owsRestWalletId in plugin config).");
      }
      wallet = this.createOwsRestLinkedWallet(walletName, publicKeyExpected, wid);
    } else {
      throw new Error(`unsupported OWS runtime: ${activeDriver}`);
    }

    const challenge = `stablepay-bind|${walletName}|${Date.now()}|${crypto.randomUUID()}`;
    const provider = this.providerForDriver(activeDriver);
    const signature = await provider.signMessage(wallet, {
      message: challenge,
      chain: "solana",
      append_timestamp_nonce: false,
    });

    if (!verifySolanaWalletMessageUtf8(challenge, signature, publicKeyExpected)) {
      throw new Error(
        "Bind verification failed: signature does not match public_key for this wallet_name (wrong name, key, or signing runtime).",
      );
    }

    const state = await this.loadState();
    state.wallet = wallet;
    await this.saveState(state);

    return {
      runtime_driver: activeDriver,
      wallet_id: wallet.walletId,
      wallet_name: wallet.walletName,
      did: wallet.did,
      public_key: wallet.publicKey,
      wallet_address: wallet.walletAddress,
      created_at: wallet.createdAt,
      bind_verified: true,
      notes: availability.notes,
    };
  }

  async registerWallet(record: DIDRecord) {
    const state = await this.requireWalletState();
    state.backendDid = record;
    const root = await this.loadState();
    root.wallet = state;
    await this.saveState(root);
  }

  async configurePaymentLimits(params: ConfigurePaymentLimitsParams) {
    if (params.single_purchase_limit_usdc <= 0) {
      throw new Error("single_purchase_limit_usdc must be greater than 0");
    }

    if (params.auto_purchase_threshold_usdc < 0) {
      throw new Error("auto_purchase_threshold_usdc must be >= 0");
    }

    if (params.auto_purchase_threshold_usdc > params.single_purchase_limit_usdc) {
      throw new Error("auto_purchase_threshold_usdc cannot exceed single_purchase_limit_usdc");
    }

    const state = await this.loadState();
    state.paymentConfig = {
      singlePurchaseLimitUsdc: params.single_purchase_limit_usdc,
      autoPurchaseThresholdUsdc: params.auto_purchase_threshold_usdc,
      currency: params.currency ?? "USDC",
      updatedAt: new Date().toISOString(),
    };
    await this.saveState(state);

    return {
      ok: true,
      payment_config: state.paymentConfig,
      local_state_path: this.cfg.localStatePath,
    };
  }

  async buildPaymentPolicy(params: BuildPaymentPolicyParams) {
    const state = await this.loadState();
    if (!state.wallet) throw new Error("No local wallet found. Create or bind a wallet first.");
    if (!state.paymentConfig) throw new Error("No payment config found. Configure payment limits first.");

    const createdAt = new Date().toISOString();
    const policyId = `policy_${crypto.randomUUID()}`;
    const policyDir = path.join(path.dirname(this.cfg.localStatePath), "policies");
    const policyPath = path.join(policyDir, `${policyId}.json`);

    const manifest = {
      kind: "stablepay-ows-ready-policy",
      version: 1,
      wallet_id: state.wallet.walletId,
      wallet_name: state.wallet.walletName,
      owner_or_agent: params.owner_or_agent ?? "agent",
      allowed_chains: ["solana"],
      purpose: params.purpose ?? "stablepay-payment",
      currency: params.currency ?? state.paymentConfig.currency,
      recipient_wallet: params.recipient_wallet ?? "",
      skill_did: params.skill_did ?? "",
      expires_at: params.expires_at ?? "",
      limits: {
        single_purchase_limit_usdc: state.paymentConfig.singlePurchaseLimitUsdc,
        auto_purchase_threshold_usdc: state.paymentConfig.autoPurchaseThresholdUsdc,
      },
      executable_policy_hints: [
        "amount <= single_purchase_limit_usdc",
        "recipient_wallet matches quoted skill wallet",
        "currency matches quoted currency",
        "purpose == stablepay-payment",
      ],
      generated_at: createdAt,
      runtime_driver: state.wallet.runtimeDriver,
      note:
        "This manifest is OWS-ready for the StablePay client flow. Registering it into an OWS vault is deferred until the target runtime supports it in this environment.",
    };

    await fs.mkdir(policyDir, { recursive: true });
    await fs.writeFile(policyPath, JSON.stringify(manifest, null, 2), "utf8");

    state.policy = {
      policyId,
      walletId: state.wallet.walletId,
      ownerOrAgent: params.owner_or_agent ?? "agent",
      policyPath,
      manifest,
      createdAt,
      recipientWallet: params.recipient_wallet ?? "",
      skillDid: params.skill_did ?? "",
      purpose: (params.purpose ?? "stablepay-payment"),
      currency: (params.currency ?? state.paymentConfig.currency),
      expiresAt: params.expires_at ?? "",
    };

    state.apiKey = {
      apiKeyIdMasked: "pending-ows-runtime",
      ownerOrAgent: params.owner_or_agent ?? "agent",
      createdAt,
    };

    await this.saveState(state);

    return {
      ok: true,
      policy_id: state.policy.policyId,
      policy_path: state.policy.policyPath,
      wallet_id: state.wallet.walletId,
      owner_or_agent: state.policy.ownerOrAgent,
      api_key_id_masked: state.apiKey.apiKeyIdMasked,
      manifest,
    };
  }

  async signMessage(params: SignMessageParams) {
    const state = await this.requireWalletState();
    const timestamp = params.timestamp ?? new Date().toISOString();
    const nonce = params.nonce ?? crypto.randomUUID();
    const append = params.append_timestamp_nonce ?? false;
    const payload = append ? `${params.message}${timestamp}${nonce}` : params.message;

    const signature = await this.providerForWallet(state).signMessage(state, { ...params, message: payload });

    return {
      did: state.did,
      wallet_id: state.walletId,
      wallet_address: state.walletAddress,
      public_key: state.publicKey,
      runtime_driver: state.runtimeDriver,
      signature,
      payload,
      timestamp,
      nonce,
      appended_timestamp_nonce: append,
    };
  }

  /**
   * Sign Solana legacy transaction message bytes (hex, no 0x) for partial tx signing.
   * Uses OWS `sign message --encoding hex` (or SDK / ows-rest with encoding hex).
   */
  async signSolanaTransactionMessageHex(messageHex: string): Promise<string> {
    const state = await this.requireWalletState();
    const cfg = this.cfg;
    const clean = messageHex.replace(/^0x/i, "").trim();
    if (!/^[0-9a-fA-F]+$/.test(clean) || clean.length % 2 !== 0) {
      throw new Error("signSolanaTransactionMessageHex: message must be an even-length hex string");
    }

    stablePayDebug("ows: signSolanaTransactionMessageHex", {
      runtimeDriver: state.runtimeDriver,
      walletName: state.walletName,
      walletId: state.walletId,
      walletAddress: state.walletAddress,
      publicKey: state.publicKey,
      messageHexChars: clean.length,
    });

    if (state.runtimeDriver === "ows-sdk") {
      const ows = await this.tryLoadOwsSdk();
      if (!ows) throw new Error("OWS SDK runtime is not available in this environment");
      const raw = ows.signMessage(
        state.walletName,
        "solana",
        clean,
        this.getOptionalEnv(cfg.owsPassphraseEnv),
        "hex",
        0,
        cfg.owsVaultPath || undefined,
      ).signature;
      const s = String(raw).trim();
      return s.startsWith("0x") ? s.slice(2) : s;
    }

    if (state.runtimeDriver === "ows-cli" || state.runtimeDriver === "wsl-ows") {
      return signSolanaMessageHexWithOwsCli(state.walletName, clean);
    }

    if (state.runtimeDriver === "ows-rest") {
      return this.signWithOwsRestHex(state.walletId, clean);
    }

    throw new Error(`signSolanaTransactionMessageHex: unsupported runtime ${state.runtimeDriver}`);
  }

  getConfig(): Required<PluginConfig> {
    return this.cfg;
  }

  private providerForDriver(activeDriver: Exclude<RuntimeDriver, "auto">): WalletProvider {
    return this.owsProvider;
  }

  private providerForWallet(state: WalletState): WalletProvider {
    return this.owsProvider;
  }

  async createWithOwsSdk(walletName: string): Promise<WalletState> {
    const ows = await this.tryLoadOwsSdk();
    if (!ows) throw new Error("OWS SDK runtime is not available in the current environment");

    const wallet = ows.createWallet(
      walletName,
      this.getOptionalEnv(this.cfg.owsPassphraseEnv),
      undefined,
      this.cfg.owsVaultPath || undefined,
    );

    const solanaAccount = wallet.accounts.find((account) => account.chainId.toLowerCase().includes("solana"));
    if (!solanaAccount) {
      throw new Error("OWS wallet does not expose a Solana account");
    }

    return {
      walletId: wallet.id,
      walletName: wallet.name,
      did: `did:solana:${solanaAccount.address}`,
      publicKey: solanaAccount.address,
      walletAddress: solanaAccount.address,
      runtimeDriver: "ows-sdk",
      provider: "ows",
      createdAt: wallet.createdAt || new Date().toISOString(),
    };
  }

  createOwsCliLinkedWallet(
    walletName: string,
    publicKeyBase58: string,
    driver: "ows-cli" | "wsl-ows",
  ): WalletState {
    return {
      walletId: walletName,
      walletName,
      did: `did:solana:${publicKeyBase58}`,
      publicKey: publicKeyBase58,
      walletAddress: publicKeyBase58,
      runtimeDriver: driver,
      provider: "ows",
      createdAt: new Date().toISOString(),
    };
  }

  createOwsRestLinkedWallet(
    walletName: string,
    publicKeyBase58: string,
    owsWalletUUID: string,
  ): WalletState {
    return {
      walletId: owsWalletUUID,
      walletName,
      did: `did:solana:${publicKeyBase58}`,
      publicKey: publicKeyBase58,
      walletAddress: publicKeyBase58,
      runtimeDriver: "ows-rest",
      provider: "ows",
      createdAt: new Date().toISOString(),
    };
  }

  async signWithOwsRestHex(walletId: string, messageHex: string): Promise<string> {
    const cfg = this.cfg;
    const base = this.cfg.owsRestBaseUrl.replace(/\/+$/, "");
    const signPath = this.cfg.owsRestSignPath.startsWith("/")
      ? this.cfg.owsRestSignPath
      : `/${this.cfg.owsRestSignPath}`;
    const token = process.env[this.cfg.owsRestApiKeyEnv];
    if (!token) {
      throw new Error(`Missing ${this.cfg.owsRestApiKeyEnv} for ows-rest signing`);
    }
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.cfg.owsRestAuthMode === "x_api_key") {
      headers["X-API-Key"] = token;
    } else if (this.cfg.owsRestAuthMode === "raw") {
      headers.Authorization = token;
    } else {
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(`${base}${signPath}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        walletId,
        chainId: cfg.owsRestChainId,
        message: messageHex,
        encoding: "hex",
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`ows-rest sign (hex) failed HTTP ${res.status}: ${text}`);
    }
    let parsed: { signature?: string };
    try {
      parsed = JSON.parse(text) as { signature?: string };
    } catch {
      throw new Error(`ows-rest: invalid JSON: ${text.slice(0, 200)}`);
    }
    if (!parsed.signature) {
      throw new Error("ows-rest: response missing signature");
    }
    let sig = parsed.signature.trim();
    if (sig.startsWith("0x")) sig = sig.slice(2);
    return sig;
  }

  async signWithOwsRest(chainId: string, walletId: string, message: string): Promise<string> {
    const base = this.cfg.owsRestBaseUrl.replace(/\/+$/, "");
    const signPath = this.cfg.owsRestSignPath.startsWith("/")
      ? this.cfg.owsRestSignPath
      : `/${this.cfg.owsRestSignPath}`;
    const token = process.env[this.cfg.owsRestApiKeyEnv];
    if (!token) {
      throw new Error(`Missing ${this.cfg.owsRestApiKeyEnv} for ows-rest signing`);
    }
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.cfg.owsRestAuthMode === "x_api_key") {
      headers["X-API-Key"] = token;
    } else if (this.cfg.owsRestAuthMode === "raw") {
      headers.Authorization = token;
    } else {
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(`${base}${signPath}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        walletId,
        chainId,
        message,
        encoding: "utf8",
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`ows-rest sign failed HTTP ${res.status}: ${text}`);
    }
    let parsed: { signature?: string };
    try {
      parsed = JSON.parse(text) as { signature?: string };
    } catch {
      throw new Error(`ows-rest: invalid JSON: ${text.slice(0, 200)}`);
    }
    if (!parsed.signature) {
      throw new Error("ows-rest: response missing signature");
    }
    return hexToBase58(parsed.signature);
  }

  private async requireWalletState(): Promise<WalletState> {
    const state = await this.loadState();
    if (!state.wallet) throw new Error("No local wallet found. Create or bind a wallet first.");
    return state.wallet;
  }

  private async detectAvailability(
    preferred?: Exclude<RuntimeDriver, "auto">,
  ): Promise<RuntimeAvailability> {
    const availableDrivers: Exclude<RuntimeDriver, "auto">[] = [];
    const notes: string[] = [];
    const requestedDriver = preferred ?? this.cfg.owsRuntime;

    const ows = await this.tryLoadOwsSdk();
    if (ows) {
      availableDrivers.push("ows-sdk");
    } else {
      notes.push(
        "OWS Node SDK could not be loaded in this environment. On the current Windows machine, the official package does not ship a win32 native binding yet.",
      );
    }

    if (this.cfg.owsRestBaseUrl) {
      availableDrivers.push("ows-rest");
    }

    if (owsCliOnPath()) {
      availableDrivers.push("ows-cli");
      availableDrivers.push("wsl-ows");
    }

    let activeDriver: Exclude<RuntimeDriver, "auto">;
    if (requestedDriver !== "auto") {
      if (!availableDrivers.includes(requestedDriver)) {
        throw new Error(`Requested runtime '${requestedDriver}' is not available`);
      }
      activeDriver = requestedDriver;
    } else if (availableDrivers.includes("ows-sdk")) {
      activeDriver = "ows-sdk";
    } else if (
      this.cfg.owsRestBaseUrl &&
      process.env[this.cfg.owsRestApiKeyEnv] &&
      availableDrivers.includes("ows-rest")
    ) {
      activeDriver = "ows-rest";
    } else if (availableDrivers.includes("ows-cli")) {
      activeDriver = "ows-cli";
    } else {
      throw new Error(
        "No OWS runtime available. Install OWS SDK/CLI or configure ows-rest; fallback runtimes are disabled.",
      );
    }
    if (activeDriver === "ows-cli" || activeDriver === "wsl-ows") {
      notes.push(
        "Using OWS CLI on PATH for signing (`ows sign message`). Ensure OWS_PASSPHRASE or an API token is set for unattended signing.",
      );
    }
    if (activeDriver === "ows-rest") {
      notes.push(
        "Using HTTP signMessage against owsRestBaseUrl. Align request/response with your OWS access-layer implementation.",
      );
    }

    return {
      requestedDriver,
      activeDriver,
      availableDrivers,
      notes,
    };
  }

  async tryLoadOwsSdk(): Promise<OwsSdkModule | null> {
    try {
      return (await import("@open-wallet-standard/core")) as unknown as OwsSdkModule;
    } catch {
      return null;
    }
  }

  private async loadState(): Promise<LocalPluginState> {
    try {
      const encrypted = await fs.readFile(this.cfg.localStatePath, "utf8");
      const json = decryptJson(encrypted, this.requireMasterKey());
      const parsed = JSON.parse(json) as LocalPluginState;
      if (parsed.wallet) {
        if ((parsed.wallet.runtimeDriver as unknown as string) === "local-dev") {
          throw new Error("Detected deprecated local-dev wallet state. Recreate wallet with OWS runtime.");
        }
        parsed.wallet.provider = "ows";
      }
      return { ...parsed, version: 1 };
    } catch (error) {
      if (isMissingFile(error)) return { version: 1 };
      throw new Error(`Failed to load local plugin state: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async saveState(state: LocalPluginState): Promise<void> {
    const dir = path.dirname(this.cfg.localStatePath);
    await fs.mkdir(dir, { recursive: true });
    const payload = encryptJson(JSON.stringify(state, null, 2), this.requireMasterKey());
    await fs.writeFile(this.cfg.localStatePath, payload, "utf8");
  }

  private requireMasterKey(): string {
    const key = process.env[this.cfg.localStateKeyEnv];
    if (!key) {
      throw new Error(
        `Missing ${this.cfg.localStateKeyEnv}. Set this environment variable before using the local wallet runtime.`,
      );
    }
    return key;
  }

  getOptionalEnv(name: string): string | undefined {
    const value = process.env[name];
    return value ? value : undefined;
  }
}

class OwsWalletProvider implements WalletProvider {
  readonly name = "ows" as const;

  constructor(private readonly rt: StablePayRuntime) {}

  async createWallet(
    walletName: string,
    params: CreateLocalWalletParams,
    activeDriver: Exclude<RuntimeDriver, "auto">,
  ): Promise<WalletState> {
    if (activeDriver === "ows-sdk") {
      return this.rt.createWithOwsSdk(walletName);
    }
    if (activeDriver === "ows-cli" || activeDriver === "wsl-ows") {
      const pk = params.public_key?.trim();
      if (!pk) {
        throw new Error(
          "public_key is required for ows-cli / wsl-ows: use Solana Base58 address from `ows wallet list`.",
        );
      }
      return this.rt.createOwsCliLinkedWallet(walletName, pk, activeDriver);
    }
    if (activeDriver === "ows-rest") {
      const cfg = this.rt.getConfig();
      const pk = params.public_key?.trim();
      const wid = (params.ows_wallet_id?.trim() || cfg.owsRestWalletId).trim();
      if (!pk || !wid) {
        throw new Error("ows-rest requires public_key and ows_wallet_id (or plugin config owsRestWalletId).");
      }
      return this.rt.createOwsRestLinkedWallet(walletName, pk, wid);
    }
    throw new Error(`unsupported OWS runtime: ${activeDriver}`);
  }

  async signMessage(state: WalletState, params: SignMessageParams): Promise<string> {
    const cfg = this.rt.getConfig();
    if (state.runtimeDriver === "ows-sdk") {
      const ows = await this.rt.tryLoadOwsSdk();
      if (!ows) throw new Error("OWS SDK runtime is not available in the current environment");
      return hexToBase58(
        ows.signMessage(
          state.walletName,
          params.chain ?? "solana",
          params.message,
          this.rt.getOptionalEnv(cfg.owsPassphraseEnv),
          "utf8",
          0,
          cfg.owsVaultPath || undefined,
        ).signature,
      );
    }
    if (state.runtimeDriver === "ows-cli" || state.runtimeDriver === "wsl-ows") {
      return signWithOwsCli(state.walletName, params.chain ?? "solana", params.message);
    }
    if (state.runtimeDriver === "ows-rest") {
      const chainId = params.chain && params.chain.includes(":") ? params.chain : cfg.owsRestChainId;
      return this.rt.signWithOwsRest(chainId, state.walletId, params.message);
    }
    throw new Error(`runtime ${state.runtimeDriver} is not handled by OwsWalletProvider`);
  }

}

function buildWalletName(prefix: string, userId?: string, explicitName?: string): string {
  if (explicitName) return explicitName;
  const suffix = userId?.trim() ? userId.trim() : crypto.randomUUID().slice(0, 8);
  return `${prefix}-${suffix}`;
}

function encryptJson(plaintext: string, secret: string): string {
  const key = crypto.createHash("sha256").update(secret, "utf8").digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

function decryptJson(payload: string, secret: string): string {
  const raw = Buffer.from(payload, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const body = raw.subarray(28);
  const key = crypto.createHash("sha256").update(secret, "utf8").digest();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

function isMissingFile(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT",
  );
}

function owsCliOnPath(): boolean {
  const r = spawnSync("ows", ["--version"], { encoding: "utf8", timeout: 5000 });
  if (r.status === 0) return true;
  const h = spawnSync("ows", ["help"], { encoding: "utf8", timeout: 5000 });
  return h.status === 0;
}

function signWithOwsCli(walletName: string, chain: string, message: string): string {
  const result = spawnSync(
    "ows",
    ["sign", "message", "--wallet", walletName, "--chain", chain, "--message", message, "--json"],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, env: process.env },
  );
  const errText = (result.stderr || result.stdout || result.error?.message || "").trim();
  if (result.status !== 0) {
    throw new Error(`ows sign message failed (exit ${result.status}): ${errText || "no output"}`);
  }
  let parsed: { signature?: string };
  try {
    parsed = JSON.parse(result.stdout || "{}") as { signature?: string };
  } catch {
    throw new Error(`ows sign message: invalid JSON: ${(result.stdout || "").slice(0, 200)}`);
  }
  if (!parsed.signature) {
    throw new Error("ows sign message: JSON missing signature field");
  }
  return hexToBase58(parsed.signature);
}

function hexToBase58(hex: string): string {
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  return base58Encode(Buffer.from(normalized, "hex"));
}

function base58Encode(input: Uint8Array): string {
  if (input.length === 0) return "";

  const digits = [0];
  for (const byte of input) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) {
      carry += digits[i]! << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  let prefix = "";
  for (const byte of input) {
    if (byte !== 0) break;
    prefix += BASE58_ALPHABET[0];
  }

  return `${prefix}${digits.reverse().map((digit) => BASE58_ALPHABET[digit]!).join("")}`;
}
