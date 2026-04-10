import { createHash } from "node:crypto";
import { buildPartiallySignedSplTransferTx } from "./tx_builder.js";
function solanaPubkeyFromSkillDid(skillDid) {
    const prefix = "did:solana:";
    if (!skillDid.startsWith(prefix)) {
        throw new Error(`skill_did must be did:solana:<pubkey>, got: ${skillDid}`);
    }
    return skillDid.slice(prefix.length);
}
function resolveFeePayer(cfg) {
    const fromEnv = process.env.STABLEPAY_FEE_PAYER_SOL?.trim();
    if (fromEnv)
        return fromEnv;
    const fromCfg = cfg.feePayerSolanaAddress?.trim();
    if (fromCfg)
        return fromCfg;
    throw new Error("Missing fee payer (hotwallet) Solana address. Set plugin config feePayerSolanaAddress or env STABLEPAY_FEE_PAYER_SOL to match blockchain-adapter hotwallet.json.");
}
export function toMinorUnitsInt(amount) {
    const normalized = amount.trim();
    if (!/^\d+(\.\d{1,6})?$/.test(normalized)) {
        throw new Error(`Invalid token amount: ${amount}`);
    }
    const [whole, fraction = ""] = normalized.split(".");
    const paddedFraction = `${fraction}000000`.slice(0, 6);
    return Number.parseInt(whole, 10) * 1_000_000 + Number.parseInt(paddedFraction, 10);
}
function currencyEnum(currency) {
    return currency === "USDT" ? 2 : 1;
}
/** Key order fixed for stable SHA256 across runtimes (ows-pay.md). */
export function stablePayPayBodyStringify(input) {
    return JSON.stringify({
        agent_did: input.agent_did,
        skill_did: input.skill_did,
        amount: input.amount,
        currency: input.currency,
        signed_tx_base64: input.signed_tx_base64,
        signature: input.signature,
        order_id: input.order_id,
        timestamp: input.timestamp,
        nonce: input.nonce,
    });
}
/**
 * Full ows-pay.md flow: partial SPL transfer (buyer signs message), business sign, gateway sign, POST /api/v1/pay.
 */
export async function settlePaymentViaGateway(input) {
    const { requirement, paymentLimits } = input;
    const price = requirement.price || "1.00";
    const currency = requirement.currency || paymentLimits.currency;
    const amount = Number.parseFloat(price);
    if (Number.isNaN(amount)) {
        throw new Error(`Invalid quoted price: ${price}`);
    }
    if (amount > paymentLimits.singlePurchaseLimitUsdc) {
        return {
            ok: false,
            status: "policy_denied",
            detail: `Quoted price ${price} exceeds single purchase limit ${paymentLimits.singlePurchaseLimitUsdc} ${paymentLimits.currency}`,
            requirement,
        };
    }
    if (!input.confirmOverThreshold && amount > paymentLimits.autoPurchaseThresholdUsdc) {
        return {
            ok: false,
            status: "manual_confirmation_required",
            detail: `Quoted price ${price} exceeds auto-purchase threshold ${paymentLimits.autoPurchaseThresholdUsdc} ${paymentLimits.currency}`,
            requirement,
        };
    }
    const feePayer = resolveFeePayer(input.cfg);
    const mint = input.cfg.splTokenMintAddress.trim();
    const rpc = input.cfg.solanaRpcUrl.trim();
    const sellerSol = solanaPubkeyFromSkillDid(requirement.skill_did);
    const amountMinor = BigInt(toMinorUnitsInt(price));
    const ccy = currencyEnum(currency);
    const { signed_tx_base64, signed_tx_hash_sha256 } = await buildPartiallySignedSplTransferTx({
        rpcUrl: rpc,
        mintAddress: mint,
        fromWalletAddress: input.agentWalletAddress,
        toWalletAddress: sellerSol,
        feePayerAddress: feePayer,
        amountMinor,
        signSolanaTxMessageHex: (hex) => input.runtime.signSolanaTransactionMessageHex(hex),
    });
    const bizTs = Math.floor(Date.now() / 1000);
    const bizNonce = `biz-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    const bizMessageCore = `${input.agentDid}|${requirement.skill_did}|${amountMinor}|${ccy}|${signed_tx_hash_sha256}`;
    const bizSignPayload = `${bizMessageCore}${bizTs}${bizNonce}`;
    const bizSig = await input.runtime.signMessage({
        message: bizSignPayload,
        chain: "solana",
        append_timestamp_nonce: false,
    });
    const orderId = `openclaw-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    const compactBody = stablePayPayBodyStringify({
        agent_did: input.agentDid,
        skill_did: requirement.skill_did,
        amount: price,
        currency,
        signed_tx_base64: signed_tx_base64,
        signature: bizSig.signature,
        order_id: orderId,
        timestamp: bizTs,
        nonce: bizNonce,
    });
    const payPath = "/api/v1/pay";
    const bodyHash = createHash("sha256").update(compactBody, "utf8").digest("hex");
    const canonical = `POST\n${payPath}\n\n${bodyHash}`;
    const gatewayTimestamp = new Date().toISOString();
    const gatewayNonce = `gw-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    const gatewaySignature = await input.runtime.signMessage({
        message: canonical,
        chain: "solana",
        timestamp: gatewayTimestamp,
        nonce: gatewayNonce,
        append_timestamp_nonce: true,
    });
    const idemKey = `openclaw-${bizNonce}`;
    const payResponse = await input.client.postJsonRaw(payPath, compactBody, {
        "X-StablePay-DID": input.agentDid,
        "X-StablePay-Signature": gatewaySignature.signature,
        "X-StablePay-Timestamp": gatewayTimestamp,
        "X-StablePay-Nonce": gatewayNonce,
        "X-Idempotency-Key": idemKey,
    });
    return {
        ok: true,
        result: {
            pay_response: payResponse,
            agent_did: input.agentDid,
            skill_did: requirement.skill_did,
            price,
            currency,
            amount_minor: Number(amountMinor),
            signed_tx_hash_sha256,
            order_id: orderId,
            gateway: { timestamp: gatewayTimestamp, nonce: gatewayNonce, canonical },
            business: { message_core: bizMessageCore, timestamp: bizTs, nonce: bizNonce },
            compact_body: compactBody,
        },
    };
}
