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

const walletName = required("wallet-name");
const publicKey = required("public-key");
const runtime = getArg("runtime", "ows-sdk");
const userType = getArg("user-type", "agent");
const singleLimit = Number(getArg("single-limit", "10"));
const autoLimit = Number(getArg("auto-limit", "5"));
const currency = getArg("currency", "USDC");

const fakeApi = {
  pluginConfig: {
    backendBaseUrl: getArg("backend-base-url", "http://127.0.0.1:28080"),
    didRegisterPath: getArg("did-register-path", "/api/v1/did/register"),
    solanaRpcUrl: getArg("solana-rpc-url", "https://api.devnet.solana.com"),
    splTokenMintAddress: getArg(
      "spl-token-mint-address",
      "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    ),
    feePayerSolanaAddress: process.env.STABLEPAY_FEE_PAYER_SOL || "",
    owsRuntime: runtime,
  },
};

const cfg = getPluginConfig(fakeApi);
const rt = new StablePayRuntime(cfg);
const client = new StablePayClient(cfg);

console.log("=== config ===");
console.log(JSON.stringify({
  backendBaseUrl: cfg.backendBaseUrl,
  didRegisterPath: cfg.didRegisterPath,
  localStatePath: cfg.localStatePath,
  localStateKeyEnv: cfg.localStateKeyEnv,
  hasMasterKey: !!process.env[cfg.localStateKeyEnv],
  runtime,
  walletName,
  publicKey,
}, null, 2));

console.log("\n=== step 1: create local wallet ===");
const created = await rt.createLocalWallet({
  wallet_name: walletName,
  runtime,
  public_key: publicKey,
  user_type: userType,
});
console.log(JSON.stringify(created, null, 2));

console.log("\n=== step 2: register local did ===");
const statusAfterCreate = await rt.getStatus();
if (!statusAfterCreate.wallet) {
  throw new Error("No wallet after createLocalWallet");
}

const registered = await client.registerLocalDid(
  {
    user_type: userType,
    public_key: statusAfterCreate.wallet.wallet_address,
    wallet_address: statusAfterCreate.wallet.wallet_address,
    wallet_id: statusAfterCreate.wallet.wallet_id,
    wallet_name: statusAfterCreate.wallet.wallet_name,
    metadata: {
      sign_runtime: statusAfterCreate.active_driver,
      source: "@stablepay/openclaw-plugin",
    },
  },
  cfg.didRegisterPath,
);

// 兼容两种后端：
// 1) 新后端：直接返回完整 DIDRecord
// 2) 旧后端/再次运行：如果 did already exists，但没带完整字段，则本地兜底补齐
let backendRecord = registered;
if (
  (!registered?.did || !registered?.wallet_address) &&
  registered?.base?.code === 10002
) {
  backendRecord = {
    did: `did:solana:${statusAfterCreate.wallet.wallet_address}`,
    public_key: statusAfterCreate.wallet.wallet_address,
    wallet_address: statusAfterCreate.wallet.wallet_address,
    wallet_id: statusAfterCreate.wallet.wallet_id,
    wallet_name: statusAfterCreate.wallet.wallet_name,
    created_at: "",
  };
}

await rt.registerWallet(backendRecord);
console.log(JSON.stringify(backendRecord, null, 2));

console.log("\n=== step 3: configure payment limits ===");
const configured = await rt.configurePaymentLimits({
  single_purchase_limit_usdc: singleLimit,
  auto_purchase_threshold_usdc: autoLimit,
  currency,
});
console.log(JSON.stringify(configured, null, 2));

console.log("\n=== final status ===");
const finalStatus = await rt.getStatus();
console.log(JSON.stringify(finalStatus, null, 2));

const expectedDid = `did:solana:${publicKey}`;
const finalDid = finalStatus.wallet?.backend_did || "";
const finalWallet = finalStatus.wallet?.wallet_address || "";

console.log("\n=== consistency check ===");
console.log(JSON.stringify({
  expectedDid,
  finalDid,
  finalWallet,
  walletMatchesInput: finalWallet === publicKey,
  didMatchesInput: finalDid === expectedDid,
}, null, 2));