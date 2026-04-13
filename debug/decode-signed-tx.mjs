import { Transaction, PublicKey } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

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

const txBase64 = required("tx-base64");
const mint = required("mint");
const fromOwner = required("from-owner");
const toOwner = required("to-owner");
const feePayerExpected = getArg("fee-payer", "");

const txBuf = Buffer.from(txBase64, "base64");
const tx = Transaction.from(txBuf);
const msg = tx.compileMessage();

const mintPk = new PublicKey(mint);
const fromOwnerPk = new PublicKey(fromOwner);
const toOwnerPk = new PublicKey(toOwner);

const expectedFromAta = getAssociatedTokenAddressSync(
  mintPk,
  fromOwnerPk,
  false,
  TOKEN_PROGRAM_ID,
);

const expectedToAta = getAssociatedTokenAddressSync(
  mintPk,
  toOwnerPk,
  false,
  TOKEN_PROGRAM_ID,
);

function short(s) {
  return `${s.slice(0, 6)}...${s.slice(-6)}`;
}

console.log("=== basic ===");
console.log(JSON.stringify({
  txBase64Length: txBase64.length,
  numSignaturesSlots: tx.signatures.length,
  numRequiredSignatures: msg.header.numRequiredSignatures,
  numReadonlySignedAccounts: msg.header.numReadonlySignedAccounts,
  numReadonlyUnsignedAccounts: msg.header.numReadonlyUnsignedAccounts,
  recentBlockhash: msg.recentBlockhash,
  feePayer: tx.feePayer?.toBase58() || null,
  feePayerMatchesExpected: feePayerExpected
    ? (tx.feePayer?.toBase58() === feePayerExpected)
    : null,
}, null, 2));

console.log("\n=== signer slots ===");
tx.signatures.forEach((sigObj, i) => {
  const pk = sigObj.publicKey.toBase58();
  const sig = sigObj.signature;
  console.log(JSON.stringify({
    signerIndex: i,
    publicKey: pk,
    short: short(pk),
    hasSignature: !!sig,
    signatureHexPrefix: sig ? Buffer.from(sig).toString("hex").slice(0, 32) : null,
  }, null, 2));
});

console.log("\n=== message account keys (ordered) ===");
msg.accountKeys.forEach((pk, i) => {
  const key = pk.toBase58();
  const isSigner = i < msg.header.numRequiredSignatures;
  let isWritable = false;

  if (isSigner) {
    isWritable = i < (msg.header.numRequiredSignatures - msg.header.numReadonlySignedAccounts);
  } else {
    const unsignedIndex = i - msg.header.numRequiredSignatures;
    const totalUnsigned = msg.accountKeys.length - msg.header.numRequiredSignatures;
    isWritable = unsignedIndex < (totalUnsigned - msg.header.numReadonlyUnsignedAccounts);
  }

  console.log(JSON.stringify({
    index: i,
    publicKey: key,
    short: short(key),
    isSigner,
    isWritable,
    isFeePayer: i === 0,
    isExpectedFromOwner: key === fromOwner,
    isExpectedToOwner: key === toOwner,
    isExpectedFeePayer: feePayerExpected ? key === feePayerExpected : null,
    isExpectedFromAta: key === expectedFromAta.toBase58(),
    isExpectedToAta: key === expectedToAta.toBase58(),
    isTokenProgram: key === TOKEN_PROGRAM_ID.toBase58(),
    isAssociatedTokenProgram: key === ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
  }, null, 2));
});

console.log("\n=== expected ATA ===");
console.log(JSON.stringify({
  mint,
  fromOwner,
  toOwner,
  feePayerExpected: feePayerExpected || null,
  expectedFromAta: expectedFromAta.toBase58(),
  expectedToAta: expectedToAta.toBase58(),
}, null, 2));

console.log("\n=== instructions ===");
tx.instructions.forEach((ix, ixIndex) => {
  const programId = ix.programId.toBase58();

  console.log(`--- instruction ${ixIndex} ---`);
  console.log(JSON.stringify({
    ixIndex,
    programId,
    isTokenProgram: programId === TOKEN_PROGRAM_ID.toBase58(),
    isAssociatedTokenProgram: programId === ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
    dataHex: Buffer.from(ix.data).toString("hex"),
  }, null, 2));

  ix.keys.forEach((k, keyIndex) => {
    const pk = k.pubkey.toBase58();
    console.log(JSON.stringify({
      ixIndex,
      keyIndex,
      publicKey: pk,
      short: short(pk),
      isSigner: k.isSigner,
      isWritable: k.isWritable,
      isExpectedFromOwner: pk === fromOwner,
      isExpectedToOwner: pk === toOwner,
      isExpectedFeePayer: feePayerExpected ? pk === feePayerExpected : null,
      isExpectedFromAta: pk === expectedFromAta.toBase58(),
      isExpectedToAta: pk === expectedToAta.toBase58(),
      isTokenProgram: pk === TOKEN_PROGRAM_ID.toBase58(),
      isAssociatedTokenProgram: pk === ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
    }, null, 2));
  });
});

console.log("\n=== quick read guide ===");
console.log([
  "1) feePayer 只表示谁付 SOL 手续费",
  "2) 真正 SPL 扣款来源，看 TOKEN_PROGRAM 那条 instruction",
  "3) source token account == expectedFromAta 且 authority == fromOwner，说明买家在付 USDC",
  "4) destination token account == expectedToAta，说明卖家 ATA 正确",
].join("\n"));