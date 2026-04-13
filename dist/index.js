import { Type } from "@sinclair/typebox";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { StablePayClient, StablePayHttpError } from "./client.js";
import { getPluginConfig } from "./config.js";
import { settlePaymentViaGateway } from "./pay_settlement.js";
import { StablePayRuntime } from "./runtime.js";
import { initStablePayPluginLogging, stablePayInfo } from "./plugin_log.js";
import { buildVerifyLink, extractHandleFromTweetUrl, formatJson } from "./utils.js";
export default definePluginEntry({
    id: "stablepay-agentpay-dev",
    name: "stablepay-agentpay-dev",
    description: "StablePay wallet runtime, client-side DID registration, OWS/local signing, and payment flows for OpenClaw.",
    register(api) {
        const cfg = getPluginConfig(api);
        initStablePayPluginLogging(api.logger, cfg);
        const client = new StablePayClient(cfg);
        const runtime = new StablePayRuntime(cfg);
        api.logger.info(`StablePay plugin loaded with backend ${cfg.backendBaseUrl}`);
        stablePayInfo("plugin: init", {
            backendBaseUrl: cfg.backendBaseUrl,
            pluginDebug: cfg.pluginDebug,
            STABLEPAY_PLUGIN_DEBUG: process.env.STABLEPAY_PLUGIN_DEBUG ?? "(unset)",
        });
        api.registerTool({
            label: "StablePay Runtime Status",
            name: "stablepay_runtime_status",
            description: "Show StablePay runtime status, configured state path, active wallet, and OWS runtime availability.",
            parameters: Type.Object({}, { additionalProperties: false }),
            async execute() {
                try {
                    const status = await runtime.getStatus();
                    return textResult([
                        `StablePay runtime status loaded.`,
                        `Requested driver: ${status.requested_driver}`,
                        `Active driver: ${status.active_driver}`,
                        `Available drivers: ${status.available_drivers.join(", ")}`,
                        `Local state path: ${status.local_state_path}`,
                        `Wallet present: ${status.has_wallet}`,
                        `JSON:`,
                        formatJson(status),
                    ].join("\n"));
                }
                catch (error) {
                    return errorResult("Failed to inspect StablePay runtime status", error);
                }
            },
        });
        api.registerTool({
            label: "Create Local Wallet",
            name: "stablepay_create_local_wallet",
            description: "Create a **new** StablePay/OWS wallet (SDK path calls `createWallet`). For an **existing** vault wallet by name, use `stablepay_bind_existing_wallet` instead.",
            parameters: Type.Object({
                user_id: Type.Optional(Type.String({ description: "Stable user identifier used in the wallet name, for example alice." })),
                user_type: Type.Optional(Type.Union([Type.Literal("agent"), Type.Literal("developer")])),
                wallet_name: Type.Optional(Type.String({ description: "Optional explicit wallet name. Defaults to stablepay-{user_id}." })),
                runtime: Type.Optional(Type.Union([
                    Type.Literal("ows-sdk"),
                    Type.Literal("ows-cli"),
                    Type.Literal("wsl-ows"),
                    Type.Literal("ows-rest"),
                ])),
                public_key: Type.Optional(Type.String({
                    description: "Required for ows-cli, wsl-ows, ows-rest: Solana public key Base58 from OWS (`ows wallet list`). Not used for ows-sdk create path.",
                })),
                ows_wallet_id: Type.Optional(Type.String({ description: "OWS wallet UUID for ows-rest when not set in plugin config." })),
            }, { additionalProperties: false }),
            async execute(_id, params) {
                try {
                    const created = await runtime.createLocalWallet(params);
                    return textResult([
                        `StablePay local wallet created successfully.`,
                        `DID: ${created.did}`,
                        `Wallet: ${created.wallet_address}`,
                        `Wallet ID: ${created.wallet_id}`,
                        `Runtime: ${created.runtime_driver}`,
                        `JSON:`,
                        formatJson(created),
                    ].join("\n"));
                }
                catch (error) {
                    return errorResult("Failed to create StablePay local wallet", error);
                }
            },
        });
        api.registerTool({
            label: "Bind Existing Wallet",
            name: "stablepay_bind_existing_wallet",
            description: "Bind an **existing** OWS wallet (already in vault / CLI / REST) to local encrypted state. Does not create a new wallet. Verifies control by signing a challenge and checking Ed25519 against `public_key`.",
            parameters: Type.Object({
                wallet_name: Type.String({ description: "Existing OWS wallet name (e.g. from `ows wallet list`)." }),
                public_key: Type.String({
                    description: "Expected Solana address Base58 for that wallet; must match vault and challenge signature.",
                }),
                runtime: Type.Optional(Type.Union([
                    Type.Literal("auto"),
                    Type.Literal("ows-sdk"),
                    Type.Literal("ows-cli"),
                    Type.Literal("wsl-ows"),
                    Type.Literal("ows-rest"),
                ])),
                ows_wallet_id: Type.Optional(Type.String({
                    description: "Required for ows-rest when plugin config has no default `owsRestWalletId`.",
                })),
            }, { additionalProperties: false }),
            async execute(_id, params) {
                try {
                    const bound = await runtime.bindExistingWallet(params);
                    return textResult([
                        `StablePay wallet bound and verified (no new wallet created).`,
                        `DID: ${bound.did}`,
                        `Wallet: ${bound.wallet_address}`,
                        `Wallet ID: ${bound.wallet_id}`,
                        `Runtime: ${bound.runtime_driver}`,
                        `JSON:`,
                        formatJson(bound),
                    ].join("\n"));
                }
                catch (error) {
                    return errorResult("Failed to bind existing StablePay wallet", error);
                }
            },
        });
        api.registerTool({
            label: "Register Local DID",
            name: "stablepay_register_local_did",
            description: "Register the current local wallet with StablePay through API Gateway. This is the target A1/A2 path when the backend supports DID registration for client-side wallets.",
            parameters: Type.Object({
                user_type: Type.Optional(Type.Union([Type.Literal("agent"), Type.Literal("developer")])),
                register_path: Type.Optional(Type.String({ description: "Optional override; default /api/v1/did/register (bind client-held wallet)." })),
            }, { additionalProperties: false }),
            async execute(_id, params) {
                try {
                    const status = await runtime.getStatus();
                    if (!status.wallet) {
                        throw new Error("No local wallet found. Create (`stablepay_create_local_wallet`) or bind (`stablepay_bind_existing_wallet`) first.");
                    }
                    let registered;
                    registered = await client.registerLocalDid({
                        user_type: params.user_type ?? "agent",
                        public_key: status.wallet.wallet_address,
                        wallet_address: status.wallet.wallet_address,
                        wallet_id: status.wallet.wallet_id,
                        wallet_name: status.wallet.wallet_name,
                        metadata: {
                            sign_runtime: status.active_driver,
                            source: "@stablepay/openclaw-plugin",
                        },
                    }, params.register_path);
                    await runtime.registerWallet(registered);
                    return textResult([
                        `StablePay DID registration completed.`,
                        `Backend DID: ${registered.did}`,
                        `Wallet: ${registered.wallet_address}`,
                        `Wallet ID: ${registered.wallet_id || status.wallet.wallet_id}`,
                        `JSON:`,
                        formatJson(registered),
                    ].join("\n"));
                }
                catch (error) {
                    return errorResult("Failed to register local wallet DID", error);
                }
            },
        });
        api.registerTool({
            label: "Configure Payment Limits",
            name: "stablepay_configure_payment_limits",
            description: "Save StablePay payment limits into the local encrypted plugin state. This is the UX layer for auto-purchase decisions before the signing runtime is invoked.",
            parameters: Type.Object({
                single_purchase_limit_usdc: Type.Number({ minimum: 0.000001 }),
                auto_purchase_threshold_usdc: Type.Number({ minimum: 0 }),
                currency: Type.Optional(Type.Union([Type.Literal("USDC"), Type.Literal("USDT")])),
            }, { additionalProperties: false }),
            async execute(_id, params) {
                try {
                    const result = await runtime.configurePaymentLimits(params);
                    return textResult([
                        `StablePay local payment limits updated.`,
                        `Single purchase limit: ${result.payment_config.singlePurchaseLimitUsdc} ${result.payment_config.currency}`,
                        `Auto purchase threshold: ${result.payment_config.autoPurchaseThresholdUsdc} ${result.payment_config.currency}`,
                        `JSON:`,
                        formatJson(result),
                    ].join("\n"));
                }
                catch (error) {
                    return errorResult("Failed to configure local payment limits", error);
                }
            },
        });
        api.registerTool({
            label: "Build Payment Policy",
            name: "stablepay_build_payment_policy",
            description: "Build a local OWS-ready payment policy manifest from the current limits and wallet state. This is the first-step integration point for future OWS policy registration.",
            parameters: Type.Object({
                skill_did: Type.Optional(Type.String()),
                recipient_wallet: Type.Optional(Type.String()),
                currency: Type.Optional(Type.Union([Type.Literal("USDC"), Type.Literal("USDT")])),
                purpose: Type.Optional(Type.String()),
                expires_at: Type.Optional(Type.String({ description: "ISO timestamp for policy expiry." })),
                owner_or_agent: Type.Optional(Type.Union([Type.Literal("owner"), Type.Literal("agent")])),
            }, { additionalProperties: false }),
            async execute(_id, params) {
                try {
                    const result = await runtime.buildPaymentPolicy(params);
                    return textResult([
                        `StablePay payment policy manifest generated.`,
                        `Policy ID: ${result.policy_id}`,
                        `Wallet ID: ${result.wallet_id}`,
                        `Policy path: ${result.policy_path}`,
                        `JSON:`,
                        formatJson(result),
                    ].join("\n"));
                }
                catch (error) {
                    return errorResult("Failed to build StablePay payment policy manifest", error);
                }
            },
        });
        api.registerTool({
            label: "Sign StablePay Message",
            name: "stablepay_sign_message",
            description: "Sign a StablePay message with the current local wallet. When append_timestamp_nonce=true, the plugin signs message+timestamp+nonce, which matches the current StablePay gateway convention.",
            parameters: Type.Object({
                message: Type.String({ description: "Message or canonical payload to sign." }),
                chain: Type.Optional(Type.String({ description: "Target chain. Defaults to solana." })),
                timestamp: Type.Optional(Type.String({ description: "Optional ISO timestamp override." })),
                nonce: Type.Optional(Type.String({ description: "Optional nonce override." })),
                append_timestamp_nonce: Type.Optional(Type.Boolean({ description: "Whether to append timestamp and nonce before signing." })),
            }, { additionalProperties: false }),
            async execute(_id, params) {
                try {
                    const result = await runtime.signMessage(params);
                    return textResult([
                        `StablePay message signed successfully.`,
                        `DID: ${result.did}`,
                        `Wallet ID: ${result.wallet_id}`,
                        `Runtime: ${result.runtime_driver}`,
                        `Signature: ${result.signature}`,
                        `Timestamp: ${result.timestamp}`,
                        `Nonce: ${result.nonce}`,
                        `JSON:`,
                        formatJson(result),
                    ].join("\n"));
                }
                catch (error) {
                    return errorResult("Failed to sign StablePay message", error);
                }
            },
        });
        api.registerTool({
            label: "Execute Paid Skill Demo",
            name: "stablepay_execute_paid_skill_demo",
            description: "Call a demo skill URL; on HTTP 402, complete StablePay payment against api-gateway (default http://127.0.0.1:28080) using ows-pay.md flow: build SPL transfer, OWS sign tx message bytes, business sign with sha256(signed_tx_base64), gateway canonical POST /api/v1/pay. Requires fee payer in config or STABLEPAY_FEE_PAYER_SOL.",
            parameters: Type.Object({
                execute_url: Type.Optional(Type.String({ description: "Demo backend execute URL. Defaults to http://127.0.0.1:8787/execute." })),
                retry_attempts: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
                retry_delay_ms: Type.Optional(Type.Integer({ minimum: 200, maximum: 10000 })),
                confirm_over_threshold: Type.Optional(Type.Boolean({
                    description: "If true, pay even when price exceeds auto-purchase threshold (user confirmed in chat). Single-purchase limit still applies.",
                })),
            }, { additionalProperties: false }),
            async execute(_id, params) {
                try {
                    const status = await runtime.getStatus();
                    if (!status.wallet) {
                        throw new Error("No local wallet found. Create (`stablepay_create_local_wallet`) or bind (`stablepay_bind_existing_wallet`) first.");
                    }
                    if (!status.wallet.backend_did) {
                        throw new Error("No backend DID mapping found. Run stablepay_register_local_did first.");
                    }
                    if (!status.payment_config) {
                        throw new Error("No local payment limits found. Run stablepay_configure_payment_limits first.");
                    }
                    const agentDid = status.wallet.backend_did;
                    const executeUrl = params.execute_url || "http://127.0.0.1:8787/execute";
                    const firstAttempt = await client.executeDemoSkill(executeUrl, agentDid);
                    if (firstAttempt.status === 200) {
                        return textResult([
                            `Demo backend access already granted.`,
                            `Agent DID: ${agentDid}`,
                            `Execute URL: ${executeUrl}`,
                            `JSON:`,
                            formatJson(firstAttempt.body),
                        ].join("\n"));
                    }
                    if (firstAttempt.status !== 402) {
                        throw new Error(`Demo backend returned unexpected status ${firstAttempt.status}`);
                    }
                    const requirement = extractPaymentRequirement(firstAttempt.body);
                    const pc = status.payment_config;
                    stablePayInfo("tool: execute_paid_skill_demo before settle", {
                        agentDid,
                        agentWalletAddress: status.wallet.wallet_address,
                        wallet_id: status.wallet.wallet_id,
                        wallet_name: status.wallet.wallet_name,
                        active_driver: status.active_driver,
                    });
                    const settled = await settlePaymentViaGateway({
                        client,
                        runtime,
                        cfg,
                        agentDid,
                        agentWalletAddress: status.wallet.wallet_address,
                        requirement,
                        paymentLimits: {
                            singlePurchaseLimitUsdc: pc.singlePurchaseLimitUsdc,
                            autoPurchaseThresholdUsdc: pc.autoPurchaseThresholdUsdc,
                            currency: pc.currency,
                        },
                        confirmOverThreshold: params.confirm_over_threshold === true,
                    });
                    if (!settled.ok) {
                        return textResult([
                            settled.status === "policy_denied"
                                ? `Local payment policy denied the purchase before signing.`
                                : `Manual confirmation is required before paying this skill.`,
                            settled.detail,
                            `JSON:`,
                            formatJson({ requirement: settled.requirement, first_attempt: firstAttempt.body }),
                        ].join("\n"), { status: settled.status, first_attempt: firstAttempt.body });
                    }
                    const { result } = settled;
                    const payResponse = result.pay_response;
                    const price = result.price;
                    const currency = result.currency;
                    const retryAttempts = params.retry_attempts ?? 6;
                    const retryDelayMs = params.retry_delay_ms ?? 1500;
                    let finalAttempt = firstAttempt;
                    for (let i = 0; i < retryAttempts; i += 1) {
                        await sleep(retryDelayMs);
                        finalAttempt = await client.executeDemoSkill(executeUrl, agentDid);
                        if (finalAttempt.status === 200) {
                            break;
                        }
                    }
                    return textResult([
                        finalAttempt.status === 200
                            ? `Paid skill demo completed successfully.`
                            : `Payment was submitted, but the demo backend still has not returned 200 yet.`,
                        `Agent DID: ${agentDid}`,
                        `Skill DID: ${requirement.skill_did}`,
                        `Quoted price: ${price} ${currency}`,
                        `Pay tx_id: ${payResponse?.tx_id ?? "(pending)"}`,
                        `Execute URL: ${executeUrl}`,
                        `Retry attempts: ${retryAttempts}`,
                        `Final execute status: ${finalAttempt.status}`,
                        `JSON:`,
                        formatJson({
                            first_attempt: firstAttempt.body,
                            payment_requirement: requirement,
                            settlement: result,
                            pay_response: result.pay_response,
                            final_attempt: finalAttempt.body,
                        }),
                    ].join("\n"));
                }
                catch (error) {
                    return errorResult("Failed to execute the paid skill demo", error);
                }
            },
        });
        api.registerTool({
            label: "Pay Skill Via Gateway",
            name: "stablepay_pay_via_gateway",
            description: "GET /api/v1/pay/require on StablePay api-gateway (e.g. localhost:28080), then on HTTP 402 run the full ows-pay.md payment (partial SPL tx + signatures + POST /api/v1/pay). Use this from chat without any external shell script.",
            parameters: Type.Object({
                skill_did: Type.String({ description: "Seller skill DID, e.g. did:solana:..." }),
                skill_name: Type.String({ description: "Skill name as registered for pay/require." }),
                price: Type.String({ description: "Decimal price string, e.g. 1.00" }),
                currency: Type.Optional(Type.Union([Type.Literal("USDC"), Type.Literal("USDT")])),
                message: Type.Optional(Type.String({ description: "Optional pay/require message." })),
                confirm_over_threshold: Type.Optional(Type.Boolean({
                    description: "Set true after user confirms a purchase above the auto-purchase threshold.",
                })),
            }, { additionalProperties: false }),
            async execute(_id, params) {
                try {
                    const status = await runtime.getStatus();
                    if (!status.wallet) {
                        throw new Error("No local wallet found. Create (`stablepay_create_local_wallet`) or bind (`stablepay_bind_existing_wallet`) first.");
                    }
                    if (!status.wallet.backend_did) {
                        throw new Error("No backend DID mapping found. Run stablepay_register_local_did first.");
                    }
                    if (!status.payment_config) {
                        throw new Error("No local payment limits found. Run stablepay_configure_payment_limits first.");
                    }
                    const agentDid = status.wallet.backend_did;
                    const pc = status.payment_config;
                    const currency = params.currency ?? pc.currency;
                    const { status: httpStatus, payload } = await client.fetchPayRequire({
                        skill_did: params.skill_did,
                        agent_did: agentDid,
                        skill_name: params.skill_name,
                        price: params.price,
                        currency,
                        message: params.message,
                    });
                    if (httpStatus === 200) {
                        return textResult([
                            `GET /api/v1/pay/require returned HTTP 200 (no payment challenge).`,
                            `If you expected HTTP 402, check skill_name, price, currency, and that the skill is paid.`,
                            `JSON:`,
                            formatJson(payload),
                        ].join("\n"), { http_status: 200, payload });
                    }
                    if (httpStatus !== 402) {
                        throw new Error(`Unexpected pay/require HTTP status ${httpStatus}`);
                    }
                    const requirement = extractPaymentRequirement(payload);
                    stablePayInfo("tool: pay_via_gateway before settle", {
                        agentDid,
                        agentWalletAddress: status.wallet.wallet_address,
                        wallet_id: status.wallet.wallet_id,
                        wallet_name: status.wallet.wallet_name,
                        active_driver: status.active_driver,
                    });
                    const settled = await settlePaymentViaGateway({
                        client,
                        runtime,
                        cfg,
                        agentDid,
                        agentWalletAddress: status.wallet.wallet_address,
                        requirement,
                        paymentLimits: {
                            singlePurchaseLimitUsdc: pc.singlePurchaseLimitUsdc,
                            autoPurchaseThresholdUsdc: pc.autoPurchaseThresholdUsdc,
                            currency: pc.currency,
                        },
                        confirmOverThreshold: params.confirm_over_threshold === true,
                    });
                    if (!settled.ok) {
                        return textResult([
                            settled.status === "policy_denied"
                                ? `Local payment policy denied the purchase before signing.`
                                : `Manual confirmation is required before paying this skill.`,
                            settled.detail,
                            `JSON:`,
                            formatJson({ requirement: settled.requirement, pay_require_response: payload }),
                        ].join("\n"), { status: settled.status, pay_require_response: payload });
                    }
                    const payResponse = settled.result.pay_response;
                    return textResult([
                        `StablePay gateway payment submitted.`,
                        `tx_id: ${payResponse?.tx_id ?? "(see JSON)"}`,
                        `JSON:`,
                        formatJson(settled.result),
                    ].join("\n"), { status: "paid", settlement: settled.result });
                }
                catch (error) {
                    return errorResult("Failed to pay via StablePay gateway", error);
                }
            },
        });
        api.registerTool({
            label: "Generate Verify Link",
            name: "stablepay_generate_verify_link",
            description: "Generate the verify page link for a StablePay DID (placeholder; X verification may be disabled).",
            parameters: Type.Object({
                did: Type.String({ description: "StablePay DID, for example did:solana:xxxx" }),
            }, { additionalProperties: false }),
            async execute(_id, params) {
                const link = buildVerifyLink(cfg.verifyPageBaseUrl, params.did);
                return textResult([
                    `Verification link generated (placeholder).`,
                    `DID: ${params.did}`,
                    `Verify URL: ${link}`,
                ].join("\n"));
            },
        }, { optional: true });
        api.registerTool({
            label: "Seed Mock Tweet",
            name: "stablepay_seed_mock_tweet",
            description: "Seed a mock X/Twitter post into the StablePay mock backend for local verification testing.",
            parameters: Type.Object({
                tweet_url: Type.String({ description: "Tweet URL, for example https://x.com/alice/status/123456789" }),
                text: Type.String({ description: "Tweet content. Include the DID verification sentence." }),
                is_public: Type.Optional(Type.Boolean({ description: "Whether the tweet is public. Defaults to true." })),
            }, { additionalProperties: false }),
            async execute(_id, params) {
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
                }
                catch (error) {
                    return errorResult("Failed to seed mock tweet", error);
                }
            },
        }, { optional: true });
        api.registerTool({
            label: "Verify X Mock",
            name: "stablepay_verify_x_mock",
            description: "Call the StablePay mock X verification API with a DID and tweet URL.",
            parameters: Type.Object({
                did: Type.String({ description: "StablePay DID" }),
                tweet_url: Type.String({ description: "Tweet URL on x.com or twitter.com" }),
            }, { additionalProperties: false }),
            async execute(_id, params) {
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
                }
                catch (error) {
                    return errorResult("Failed to verify X account", error);
                }
            },
        }, { optional: true });
        api.registerTool({
            label: "Query Balance",
            name: "stablepay_query_balance",
            description: "Query agent balance from StablePay api-gateway GET /api/v1/balance (agent_did query; falls back to legacy agent= on 400). Not on-chain RPC.",
            parameters: Type.Object({
                did: Type.String({ description: "StablePay DID" }),
            }, { additionalProperties: false }),
            async execute(_id, params) {
                try {
                    const balance = await client.getBalance(params.did);
                    return textResult([
                        `Balance query succeeded.`,
                        `DID: ${params.did}`,
                        `Balance: ${balance.balance} ${balance.currency}`,
                        `JSON:`,
                        formatJson(balance),
                    ].join("\n"));
                }
                catch (error) {
                    return errorResult("Failed to query balance", error);
                }
            },
        });
        api.registerTool({
            label: "Query Skill Sales",
            name: "stablepay_query_sales",
            description: "Query seller sales for a skill_did via StablePay api-gateway GET /api/v1/sales (DID-authenticated when gateway requires it).",
            parameters: Type.Object({
                skill_did: Type.String({ description: "Seller skill DID (did:solana:...)" }),
            }, { additionalProperties: false }),
            async execute(_id, params) {
                try {
                    const sales = await client.getSales(params.skill_did);
                    return textResult([
                        `Sales query succeeded.`,
                        `Skill DID: ${params.skill_did}`,
                        `JSON:`,
                        formatJson(sales),
                    ].join("\n"));
                }
                catch (error) {
                    return errorResult("Failed to query skill sales", error);
                }
            },
        });
        api.registerTool({
            label: "Get Verify Status",
            name: "stablepay_get_verify_status",
            description: "Check whether a DID has already completed StablePay X verification. (Optional; A1 registration chain skips X.)",
            parameters: Type.Object({
                did: Type.String({ description: "StablePay DID" }),
            }, { additionalProperties: false }),
            async execute(_id, params) {
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
                }
                catch (error) {
                    return errorResult("Failed to query verification status", error);
                }
            },
        }, { optional: true });
    },
});
function textResult(text, details = {}) {
    return {
        content: [{ type: "text", text }],
        details,
    };
}
function errorResult(prefix, error) {
    if (error instanceof StablePayHttpError) {
        const details = error.payload ? `\nPayload: ${formatJson(error.payload)}` : "";
        return textResult(`${prefix}.\nStatus: ${error.status}\nMessage: ${error.message}${details}`, {
            status: "failed",
            http_status: error.status,
            payload: error.payload ?? null,
        });
    }
    return textResult(`${prefix}.\nMessage: ${error instanceof Error ? error.message : String(error)}`, {
        status: "failed",
    });
}
function extractPaymentRequirement(payload) {
    const candidate = payload?.payment_requirement?.data ||
        payload?.payment_requirement ||
        payload?.data ||
        payload;
    if (!candidate?.skill_did) {
        throw new Error("Payment requirement payload is missing skill_did");
    }
    return candidate;
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
