import crypto from "node:crypto";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { signSolanaMessageHexWithOwsCli } from "../dist/ows_sign_tx.js";

function usage() {
  console.error(
    "usage: node scripts/build_signed_tx.mjs <rpc> <mint> <from_wallet> <to_wallet> <fee_payer_wallet> <amount_minor> <buyer_wallet_name>",
  );
  process.exit(2);
}

const args = process.argv.slice(2);
if (args.length !== 7) usage();

const [rpc, mint, fromAddr, toAddr, feePayerAddr, amountMinorStr, buyerWalletName] = args;

const amountMinor = BigInt(amountMinorStr);
if (amountMinor <= 0n) {
  throw new Error(`invalid amount_minor: ${amountMinorStr}`);
}

const conn = new Connection(rpc, "confirmed");
const mintPk = new PublicKey(mint);
const fromPk = new PublicKey(fromAddr);
const toPk = new PublicKey(toAddr);
const feePayerPk = new PublicKey(feePayerAddr);

const fromATA = getAssociatedTokenAddressSync(mintPk, fromPk, false, TOKEN_PROGRAM_ID);
const toATA = getAssociatedTokenAddressSync(mintPk, toPk, false, TOKEN_PROGRAM_ID);

const tx = new Transaction();

// 如果卖家 ATA 不存在，先由 hotwallet 付费创建
const toInfo = await conn.getAccountInfo(toATA);
if (!toInfo) {
  tx.add(createAssociatedTokenAccountInstruction(feePayerPk, toATA, toPk, mintPk));
}

// 再加 USDC 转账指令：owner = buyer(fromPk)
tx.add(createTransferInstruction(fromATA, toATA, fromPk, amountMinor, [], TOKEN_PROGRAM_ID));

// 最新 blockhash + fee payer
const { blockhash } = await conn.getLatestBlockhash("confirmed");
tx.recentBlockhash = blockhash;
tx.feePayer = feePayerPk;

// 先导出 unsigned tx（便于调试）
const unsignedRaw = tx.serialize({
  requireAllSignatures: false,
  verifySignatures: false,
});
const unsignedTxBase64 = Buffer.from(unsignedRaw).toString("base64");

// 关键点：Solana 正确签名对象是 MESSAGE bytes，不是完整 serialized transaction
const messageRaw = tx.serializeMessage();
const messageHex = Buffer.from(messageRaw).toString("hex");

// 买家只签自己那一格 signer slot
const buyerSigHex = signSolanaMessageHexWithOwsCli(buyerWalletName, messageHex);
const buyerSigBuf = Buffer.from(buyerSigHex, "hex");
if (buyerSigBuf.length !== 64) {
  throw new Error(`invalid buyer signature length: expected 64 bytes, got ${buyerSigBuf.length}`);
}
tx.addSignature(fromPk, buyerSigBuf);

// 序列化为“部分签名交易”
// - buyer 已签
// - hotwallet 作为 fee payer 还没签，等服务端补签
const partiallySignedRaw = tx.serialize({
  requireAllSignatures: false,
  verifySignatures: false,
});
const signedTxBase64 = Buffer.from(partiallySignedRaw).toString("base64");
const signedTxHash = crypto.createHash("sha256").update(signedTxBase64, "utf8").digest("hex");

process.stdout.write(
  JSON.stringify(
    {
      unsigned_tx_base64: unsignedTxBase64,
      signed_tx_base64: signedTxBase64,
      signed_tx_hash_sha256: signedTxHash,
      meta: {
        from_wallet: fromAddr,
        to_wallet: toAddr,
        fee_payer_wallet: feePayerAddr,
        mint,
        amount_minor: amountMinorStr,
        buyer_wallet_name: buyerWalletName,
      },
      debug: {
        from_ata: fromATA.toBase58(),
        to_ata: toATA.toBase58(),
        recent_blockhash: blockhash,
        message_hex_len: messageHex.length,
        buyer_signature_hex_len: buyerSigHex.length,
      },
    },
    null,
    2,
  ),
);