import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { StablePayRuntime } from "../dist/runtime.js";
import { StablePayClient } from "../dist/client.js";
import { getPluginConfig } from "../dist/config.js";

function getArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const hit = process.argv.find((x) => x.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function required(name) {
  const v = getArg(name);
  if (!v) throw new Error(`Missing --${name}=...`);
  return v;
}

function encryptJson(plaintext, secret) {
  const key = crypto.createHash("sha256").update(secret, "utf8").digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

const walletName = required("wallet-name");
const publicKey = required("public-key");
const userType = getArg("user-type", "agent");
const singleLimit = Number(getArg("single-limit", "10"));
const autoLimit = Number(getArg("auto-limit", "5"));
const currency = getArg("currency", "USDC");

const fakeApi = {
  pluginConfig: {
    backendBaseUrl: getArg("backend-base-url", "https://ai.wenfu.cn"),
    didRegisterPath: getArg("did-register-path", "/api/v1/did/register"),
    solanaRpcUrl: getArg("solana-rpc-url", "https://api.devnet.solana.com"),
    splTokenMintAddress: getArg(
      "spl-token-mint-address",
      "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    ),
    feePayerSolanaAddress: process.env.STABLEPAY_FEE_PAYER_SOL || "",
    owsRuntime: "ows-sdk",
  },
};

const cfg = getPluginConfig(fakeApi);
const client = new StablePayClient(cfg);
const runtime = new StablePayRuntime(cfg);

const masterKey = process.env[cfg.localStateKeyEnv];
if (!masterKey) {
  throw new Error(`Missing ${cfg.localStateKeyEnv}`);
}

const state = {
  version: 1,
  wallet: {
    walletId: walletName, // 对 sdk 签名不是关键；签名用的是 walletName
    walletName,
    did: `did:solana:${publicKey}`,
    publicKey,
    walletAddress: publicKey,
    runtimeDriver: "ows-sdk",
    provider: "ows",
    createdAt: new Date().toISOString(),
  },
};

const dir = path.dirname(cfg.localStatePath);
await fs.mkdir(dir, { recursive: true });
await fs.writeFile(
  cfg.localStatePath,
  encryptJson(JSON.stringify(state, null, 2), masterKey),
  "utf8",
);

console.log("=== seeded local state ===");
console.log(JSON.stringify({
  localStatePath: cfg.localStatePath,
  walletName,
  publicKey,
  runtimeDriver: "ows-sdk",
}, null, 2));

console.log("\n=== step 2: register local did ===");
const registered = await client.registerLocalDid(
  {
    user_type: userType,
    public_key: publicKey,
    wallet_address: publicKey,
    wallet_id: walletName,
    wallet_name: walletName,
    metadata: {
      sign_runtime: "ows-sdk",
      source: "@stablepay/openclaw-plugin",
    },
  },
  cfg.didRegisterPath,
);

// 兼容 “did already exists” 但后端没带全字段 的情况
let backendRecord = registered;
if (
  (!registered?.did || !registered?.wallet_address) &&
  registered?.base?.code === 10002
) {
  backendRecord = {
    did: `did:solana:${publicKey}`,
    public_key: publicKey,
    wallet_address: publicKey,
    wallet_id: walletName,
    wallet_name: walletName,
    created_at: "",
  };
}

await runtime.registerWallet(backendRecord);
console.log(JSON.stringify(backendRecord, null, 2));

console.log("\n=== step 3: configure payment limits ===");
const configured = await runtime.configurePaymentLimits({
  single_purchase_limit_usdc: singleLimit,
  auto_purchase_threshold_usdc: autoLimit,
  currency,
});
console.log(JSON.stringify(configured, null, 2));

console.log("\n=== final status ===");
const finalStatus = await runtime.getStatus();
console.log(JSON.stringify(finalStatus, null, 2));

console.log("\n=== consistency check ===");
console.log(JSON.stringify({
  expectedDid: `did:solana:${publicKey}`,
  finalWallet: finalStatus.wallet?.wallet_address || "",
  finalDid: finalStatus.wallet?.backend_did || "",
  walletMatchesInput: finalStatus.wallet?.wallet_address === publicKey,
  didMatchesInput: finalStatus.wallet?.backend_did === `did:solana:${publicKey}`,
}, null, 2));