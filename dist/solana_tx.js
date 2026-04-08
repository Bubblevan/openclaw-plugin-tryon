import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createAssociatedTokenAccountInstruction, createTransferInstruction, getAssociatedTokenAddressSync, } from "@solana/spl-token";
export async function buildUnsignedSplTransferBase64(input) {
    const conn = new Connection(input.rpcUrl, "confirmed");
    const mintPk = new PublicKey(input.mintAddress);
    const fromPk = new PublicKey(input.fromWallet);
    const toPk = new PublicKey(input.toWallet);
    const feePayerPk = new PublicKey(input.feePayerWallet);
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
