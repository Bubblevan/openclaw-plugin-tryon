import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type {
  BuildPaymentPolicyParams,
  ConfigurePaymentLimitsParams,
  CreateLocalWalletParams,
  DIDRecord,
  PluginConfig,
  RuntimeDriver,
  SignMessageParams,
} from "./types.js";

type WalletState = {
  walletId: string;
  walletName: string;
  did: string;
  publicKey: string;
  walletAddress: string;
  runtimeDriver: Exclude<RuntimeDriver, "auto">;
  createdAt: string;
  backendDid?: DIDRecord;
  localDevPrivateKeyPem?: string;
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

export class StablePayRuntime {
  constructor(private readonly cfg: Required<PluginConfig>) {}

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

    const wallet =
      availability.activeDriver === "ows-sdk"
        ? await this.createWithOwsSdk(walletName)
        : await this.createWithLocalDev(walletName);

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
    if (!state.wallet) throw new Error("No local wallet found. Create a wallet first.");
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

    let signature: string;
    if (state.runtimeDriver === "ows-sdk") {
      const ows = await this.tryLoadOwsSdk();
      if (!ows) throw new Error("OWS SDK runtime is not available in the current environment");
      signature = hexToBase58(
        ows.signMessage(
          state.walletName,
          params.chain ?? "solana",
          payload,
          this.getOptionalEnv(this.cfg.owsPassphraseEnv),
          "utf8",
          0,
          this.cfg.owsVaultPath || undefined,
        ).signature,
      );
    } else {
      if (!state.localDevPrivateKeyPem) {
        throw new Error("Local dev private key not found in local state");
      }
      const raw = crypto.sign(null, Buffer.from(payload, "utf8"), state.localDevPrivateKeyPem);
      signature = base58Encode(raw);
    }

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

  private async createWithOwsSdk(walletName: string): Promise<WalletState> {
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
      createdAt: wallet.createdAt || new Date().toISOString(),
    };
  }

  private async createWithLocalDev(walletName: string): Promise<WalletState> {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
    const publicDer = publicKey.export({ format: "der", type: "spki" });
    const rawPublic = Buffer.from(publicDer).subarray(Buffer.from(publicDer).length - 32);
    const publicKeyBase58 = base58Encode(rawPublic);

    return {
      walletId: `localdev_${crypto.randomUUID()}`,
      walletName,
      did: `did:solana:${publicKeyBase58}`,
      publicKey: publicKeyBase58,
      walletAddress: publicKeyBase58,
      runtimeDriver: "local-dev",
      createdAt: new Date().toISOString(),
      localDevPrivateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    };
  }

  private async requireWalletState(): Promise<WalletState> {
    const state = await this.loadState();
    if (!state.wallet) throw new Error("No local wallet found. Create a wallet first.");
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

    availableDrivers.push("local-dev");

    let activeDriver: Exclude<RuntimeDriver, "auto"> = "local-dev";
    if (requestedDriver !== "auto") {
      if (!availableDrivers.includes(requestedDriver)) {
        throw new Error(`Requested runtime '${requestedDriver}' is not available`);
      }
      activeDriver = requestedDriver;
    } else if (availableDrivers.includes("ows-sdk")) {
      activeDriver = "ows-sdk";
    }

    if (activeDriver === "local-dev") {
      notes.push(
        "The plugin will use a local AES-256-GCM encrypted state file as the current development fallback. This is suitable for local OpenClaw demos, but it is not the final OWS custody model.",
      );
    }

    return {
      requestedDriver,
      activeDriver,
      availableDrivers,
      notes,
    };
  }

  private async tryLoadOwsSdk(): Promise<OwsSdkModule | null> {
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

  private getOptionalEnv(name: string): string | undefined {
    const value = process.env[name];
    return value ? value : undefined;
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
