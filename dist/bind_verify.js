import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
/**
 * Verify an off-chain Ed25519 signature over UTF-8 message bytes (Solana wallet / OWS `sign message` utf8).
 * Tries ZIP-215 relaxed rules first, then RFC8032 strict (some stacks differ).
 */
export function verifySolanaWalletMessageUtf8(messageUtf8, signatureBase58, publicKeyBase58) {
    try {
        const msg = new TextEncoder().encode(messageUtf8);
        const sig = new Uint8Array(bs58.decode(signatureBase58));
        if (sig.length !== 64)
            return false;
        const pub = new Uint8Array(new PublicKey(publicKeyBase58).toBytes());
        if (ed25519.verify(sig, msg, pub))
            return true;
        return ed25519.verify(sig, msg, pub, { zip215: false });
    }
    catch {
        return false;
    }
}
