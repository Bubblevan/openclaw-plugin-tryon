import { Type } from "@sinclair/typebox";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

import { StablePayClient, StablePayHttpError } from "./client.js";
import { getPluginConfig } from "./config.js";
import type {
  BalanceParams,
  CreateWalletParams,
  SeedTweetParams,
  VerifyLinkParams,
  VerifyStatusParams,
  VerifyTwitterParams,
} from "./types.js";
import {
  buildVerifyLink,
  extractHandleFromTweetUrl,
  formatJson,
  generateMockDid,
  generateMockWalletAddress,
} from "./utils.js";

export default definePluginEntry({
  id: "stablepay-mock-plugin",
  name: "StablePay Mock Plugin",
  description: "Trial OpenClaw plugin for StablePay mock DID registration, X verification, and balance checks.",
  register(api) {
    const cfg = getPluginConfig(api);
    const client = new StablePayClient(cfg);

    api.logger.info(`StablePay plugin loaded with backend ${cfg.backendBaseUrl}`);

    api.registerTool({
      name: "stablepay_create_mock_wallet",
      description: "Create a mock StablePay DID and wallet for local testing.",
      parameters: Type.Object(
        {
          did: Type.Optional(Type.String({ description: "Optional custom DID. If omitted, the plugin will generate one." })),
          wallet_address: Type.Optional(
            Type.String({ description: "Optional custom wallet address. If omitted, the plugin will generate one." }),
          ),
        },
        { additionalProperties: false },
      ),
      async execute(_id, params: CreateWalletParams) {
        try {
          const walletAddress = params.wallet_address || generateMockWalletAddress();
          const did = params.did || generateMockDid(walletAddress);
          const created = await client.createMockDid({ did, wallet_address: walletAddress });

          return textResult([
            `Mock wallet created successfully.`,
            `DID: ${created.did}`,
            `Wallet: ${created.wallet_address}`,
            `Next step: call stablepay_generate_verify_link or stablepay_seed_mock_tweet.`,
            `JSON:`,
            formatJson(created),
          ].join("\n"));
        } catch (error) {
          return errorResult("Failed to create mock wallet", error);
        }
      },
    });

    api.registerTool({
      name: "stablepay_generate_verify_link",
      description: "Generate the verify?did=... page link for a StablePay DID.",
      parameters: Type.Object(
        {
          did: Type.String({ description: "StablePay DID, for example did:solana:xxxx" }),
        },
        { additionalProperties: false },
      ),
      async execute(_id, params: VerifyLinkParams) {
        const link = buildVerifyLink(cfg.verifyPageBaseUrl, params.did);
        return textResult([
          `Verification link generated successfully.`,
          `DID: ${params.did}`,
          `Verify URL: ${link}`,
        ].join("\n"));
      },
    });

    api.registerTool(
      {
        name: "stablepay_seed_mock_tweet",
        description: "Seed a mock X/Twitter post into the StablePay mock backend for local verification testing.",
        parameters: Type.Object(
          {
            tweet_url: Type.String({ description: "Tweet URL, for example https://x.com/alice/status/123456789" }),
            text: Type.String({ description: "Tweet content. Include the DID verification sentence." }),
            is_public: Type.Optional(Type.Boolean({ description: "Whether the tweet is public. Defaults to true." })),
          },
          { additionalProperties: false },
        ),
        async execute(_id, params: SeedTweetParams) {
          try {
            const handle = extractHandleFromTweetUrl(params.tweet_url);
            const payload = {
              tweet_url: params.tweet_url,
              text: params.text,
              is_public: params.is_public ?? true,
            };
            const seeded = await client.seedMockTweet(payload);

            return textResult([
              `Mock tweet seeded successfully for @${handle}.`,
              `You can now call stablepay_verify_x_mock with the same DID and tweet URL.`,
              `JSON:`,
              formatJson(seeded),
            ].join("\n"));
          } catch (error) {
            return errorResult("Failed to seed mock tweet", error);
          }
        },
      },
      { optional: true },
    );

    api.registerTool({
      name: "stablepay_verify_x_mock",
      description: "Call the StablePay mock X verification API with a DID and tweet URL.",
      parameters: Type.Object(
        {
          did: Type.String({ description: "StablePay DID" }),
          tweet_url: Type.String({ description: "Tweet URL on x.com or twitter.com" }),
        },
        { additionalProperties: false },
      ),
      async execute(_id, params: VerifyTwitterParams) {
        try {
          const verified = await client.verifyTwitter({ did: params.did, tweet_url: params.tweet_url });
          const reward = verified.reward_tx || "(none)";
          return textResult([
            verified.success ? `X verification succeeded.` : `X verification did not succeed.`,
            `DID: ${params.did}`,
            `Tweet: ${params.tweet_url}`,
            `Twitter Handle: ${verified.twitter_handle || "unknown"}`,
            `Reward Tx: ${reward}`,
            `Message: ${verified.message || `Mock reward amount: ${cfg.rewardAmount} USDC`}`,
            `JSON:`,
            formatJson(verified),
          ].join("\n"));
        } catch (error) {
          return errorResult("Failed to verify X account", error);
        }
      },
    });

    api.registerTool({
      name: "stablepay_query_balance",
      description: "Query the StablePay mock reward balance for a DID.",
      parameters: Type.Object(
        {
          did: Type.String({ description: "StablePay DID" }),
        },
        { additionalProperties: false },
      ),
      async execute(_id, params: BalanceParams) {
        try {
          const balance = await client.getBalance(params.did);
          return textResult([
            `Balance query succeeded.`,
            `DID: ${params.did}`,
            `Balance: ${balance.balance} ${balance.currency}`,
            `JSON:`,
            formatJson(balance),
          ].join("\n"));
        } catch (error) {
          return errorResult("Failed to query balance", error);
        }
      },
    });

    api.registerTool({
      name: "stablepay_get_verify_status",
      description: "Check whether a DID has already completed StablePay X verification.",
      parameters: Type.Object(
        {
          did: Type.String({ description: "StablePay DID" }),
        },
        { additionalProperties: false },
      ),
      async execute(_id, params: VerifyStatusParams) {
        try {
          const status = await client.getVerifyStatus(params.did);
          return textResult([
            `Verification status query succeeded.`,
            `DID: ${params.did}`,
            `Verified: ${status.verified}`,
            `Twitter Handle: ${status.twitter_handle || "(not bound)"}`,
            `Reward Tx: ${status.reward_tx || "(none)"}`,
            `JSON:`,
            formatJson(status),
          ].join("\n"));
        } catch (error) {
          return errorResult("Failed to query verification status", error);
        }
      },
    });
  },
});

function textResult(text: string) {
  return {
    content: [{ type: "text", text }],
  };
}

function errorResult(prefix: string, error: unknown) {
  if (error instanceof StablePayHttpError) {
    const details = error.payload ? `\nPayload: ${formatJson(error.payload)}` : "";
    return textResult(`${prefix}.\nStatus: ${error.status}\nMessage: ${error.message}${details}`);
  }

  return textResult(`${prefix}.\nMessage: ${error instanceof Error ? error.message : String(error)}`);
}
