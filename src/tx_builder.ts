import { createHash } from "node:crypto";

import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { stablePayDebug } from "./plugin_log.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

type BuildUnsignedSplTransferInput = {
  rpcUrl: string;
  mintAddress: string;
  fromWalletAddress: string;
  toWalletAddress: string;
  feePayerAddress: string;
  amountMinor: bigint;
};

export async function buildUnsignedSplTransferTxBase64(input: BuildUnsignedSplTransferInput): Promise<string> {
  const conn = new Connection(input.rpcUrl, "confirmed");
  const mintPk = new PublicKey(input.mintAddress);
  const fromPk = new PublicKey(input.fromWalletAddress);
  const toPk = new PublicKey(input.toWalletAddress);
  const feePayerPk = new PublicKey(input.feePayerAddress);

  const fromATA = getAssociatedTokenAddressSync(mintPk, fromPk, false, TOKEN_PROGRAM_ID);
  const toATA = getAssociatedTokenAddressSync(mintPk, toPk, false, TOKEN_PROGRAM_ID);

  const tx = new Transaction();
  const toInfo = await conn.getAccountInfo(toATA);
  if (!toInfo) {
    tx.add(createAssociatedTokenAccountInstruction(feePayerPk, toATA, toPk, mintPk));
  }
  tx.add(createTransferInstruction(fromATA, toATA, fromPk, input.amountMinor, [], TOKEN_PROGRAM_ID));

  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = feePayerPk;

  const raw = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return Buffer.from(raw).toString("base64");
}

export type PartialSignSplInput = {
  rpcUrl: string;
  mintAddress: string;
  fromWalletAddress: string;
  toWalletAddress: string;
  feePayerAddress: string;
  amountMinor: bigint;
  signSolanaTxMessageHex: (messageHex: string) => Promise<string>;
};

/**
 * Buyer signs `tx.serializeMessage()` via OWS (hex), then embeds ed25519 sig — hotwallet fee payer unsigned server-side.
 * Matches stablepay-openclaw-plugin/scripts/build_signed_tx.mjs + ows-pay.md §6.
 */
export async function buildPartiallySignedSplTransferTx(
  input: PartialSignSplInput,
): Promise<{ signed_tx_base64: string; unsigned_tx_base64: string; signed_tx_hash_sha256: string }> {
  const conn = new Connection(input.rpcUrl, "confirmed");
  const mintPk = new PublicKey(input.mintAddress);
  const fromPk = new PublicKey(input.fromWalletAddress);
  const toPk = new PublicKey(input.toWalletAddress);
  const feePayerPk = new PublicKey(input.feePayerAddress);

  const fromATA = getAssociatedTokenAddressSync(mintPk, fromPk, false, TOKEN_PROGRAM_ID);
  const toATA = getAssociatedTokenAddressSync(mintPk, toPk, false, TOKEN_PROGRAM_ID);

  const tx = new Transaction();
  const toInfo = await conn.getAccountInfo(toATA);
  if (!toInfo) {
    tx.add(createAssociatedTokenAccountInstruction(feePayerPk, toATA, toPk, mintPk));
  }
  tx.add(createTransferInstruction(fromATA, toATA, fromPk, input.amountMinor, [], TOKEN_PROGRAM_ID));

  stablePayDebug("spl_tx: transfer instruction", {
    spl_source_ata: fromATA.toBase58(),
    spl_dest_ata: toATA.toBase58(),
    authority_pubkey: fromPk.toBase58(),
    fee_payer_pubkey: feePayerPk.toBase58(),
    fee_payer_same_as_transfer_authority: fromPk.equals(feePayerPk),
    amount_minor: String(input.amountMinor),
  });

  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = feePayerPk;

  const unsignedRaw = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  const unsigned_tx_base64 = Buffer.from(unsignedRaw).toString("base64");

  const messageHex = Buffer.from(tx.serializeMessage()).toString("hex");
  stablePayDebug("spl_tx: signing serialized message", {
    message_hex_chars: messageHex.length,
    unsigned_tx_base64_chars: unsigned_tx_base64.length,
  });

  const buyerSigHex = await input.signSolanaTxMessageHex(messageHex);
  const buyerSigBuf = Buffer.from(buyerSigHex.replace(/^0x/i, ""), "hex");
  if (buyerSigBuf.length !== 64) {
    throw new Error(`invalid buyer signature length: expected 64 bytes, got ${buyerSigBuf.length}`);
  }
  stablePayDebug("spl_tx: buyer signature bytes", { len: buyerSigBuf.length });
  tx.addSignature(fromPk, buyerSigBuf);

  const partiallySignedRaw = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  const signed_tx_base64 = Buffer.from(partiallySignedRaw).toString("base64");
  const signed_tx_hash_sha256 = createHash("sha256").update(signed_tx_base64, "utf8").digest("hex");

  return { signed_tx_base64, unsigned_tx_base64, signed_tx_hash_sha256 };
}

