import { StablePayRuntime } from "../dist/runtime.js";
import { StablePayClient } from "../dist/client.js";
import { getPluginConfig } from "../dist/config.js";
import { settlePaymentViaGateway } from "../dist/pay_settlement.js";

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

const skillDid = required("skill-did");
const skillName = required("skill-name");
const price = required("price");
const currencyArg = getArg("currency", "");
const message = getArg("message", "");
const confirmOverThreshold = getArg("confirm-over-threshold", "false") === "true";

const fakeApi = {
  pluginConfig: {
    backendBaseUrl: getArg("backend-base-url", "https://ai.wenfu.cn"),
    didRegisterPath: getArg("did-register-path", "/api/v1/did/register"),
    solanaRpcUrl: getArg("solana-rpc-url", "https://api.devnet.solana.com"),
    solanaRpcUrl: getArg("solana-rpc-url", "https://api.devnet.solana.com"),
    splTokenMintAddress: getArg(
      "spl-token-mint-address",
      "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    ),
    feePayerSolanaAddress: process.env.STABLEPAY_FEE_PAYER_SOL || "",
    owsRuntime: "auto",
  },
};

function extractPaymentRequirement(payload) {
  const candidate =
    payload?.payment_requirement?.data ||
    payload?.payment_requirement ||
    payload?.data ||
    payload;

  if (!candidate?.skill_did) {
    throw new Error("Payment requirement payload is missing skill_did");
  }
  return candidate;
}

const cfg = getPluginConfig(fakeApi);
const rt = new StablePayRuntime(cfg);
const client = new StablePayClient(cfg);

console.log("=== load status ===");
const status = await rt.getStatus();
console.log(JSON.stringify(status, null, 2));

if (!status.wallet) {
  throw new Error("No local wallet found. Run reinit-state.mjs first.");
}
if (!status.wallet.backend_did) {
  throw new Error("No backend DID mapping found. Run reinit-state.mjs / stablepay_register_local_did first.");
}
if (!status.payment_config) {
  throw new Error("No local payment limits found. Run reinit-state.mjs / stablepay_configure_payment_limits first.");
}

const agentDid = status.wallet.backend_did;
const pc = status.payment_config;
const currency = currencyArg || pc.currency;

console.log("\n=== step 1: GET /api/v1/pay/require ===");
const { status: httpStatus, payload } = await client.fetchPayRequire({
  skill_did: skillDid,
  agent_did: agentDid,
  skill_name: skillName,
  price,
  currency,
  message: message || undefined,
});

console.log(JSON.stringify({ httpStatus, payload }, null, 2));

if (httpStatus === 200) {
  console.log("\nNo payment challenge. Check skill_name / price / currency / whether skill is paid.");
  process.exit(0);
}

if (httpStatus !== 402) {
  throw new Error(`Unexpected pay/require HTTP status ${httpStatus}`);
}

const requirement = extractPaymentRequirement(payload);

console.log("\n=== step 2: settlePaymentViaGateway ===");
console.log(JSON.stringify({
  agentDid,
  agentWalletAddress: status.wallet.wallet_address,
  walletId: status.wallet.wallet_id,
  walletName: status.wallet.wallet_name,
  activeDriver: status.active_driver,
  requirement,
}, null, 2));

const settled = await settlePaymentViaGateway({
  client,
  runtime: rt,
  cfg,
  agentDid,
  agentWalletAddress: status.wallet.wallet_address,
  requirement,
  paymentLimits: {
    singlePurchaseLimitUsdc: pc.singlePurchaseLimitUsdc,
    autoPurchaseThresholdUsdc: pc.autoPurchaseThresholdUsdc,
    currency: pc.currency,
  },
  confirmOverThreshold,
});

console.log("\n=== result ===");
console.log(JSON.stringify(settled, null, 2));

if (!settled.ok) {
  console.log("\nPayment not sent.");
  process.exit(0);
}

console.log("\n=== pay_response ===");
console.log(JSON.stringify(settled.result.pay_response, null, 2));

console.log("\n=== useful fields ===");
console.log(JSON.stringify({
  tx_id: settled.result.pay_response?.tx_id || null,
  signed_tx_hash_sha256: settled.result.signed_tx_hash_sha256,
  gateway: settled.result.gateway,
  business: settled.result.business,
}, null, 2));