---
name: showmethemoney-skill
description: Paid StablePay demo skill for the A2 chain. Use when the user wants to simulate a paid skill purchase with OpenClaw, local wallet signing, and StablePay backend verification.
---

# ShowMeTheMoney Skill

This skill is the demo buyer-side target for the StablePay A2 flow.

## What this skill assumes

- OpenClaw has the `stablepay-mock-plugin` installed
- the plugin has a local wallet runtime available
- the StablePay backend is reachable through `api-gateway`
- payment execution is still backed by the existing StablePay HTTP 402 and `/api/v1/pay` flow

## Recommended preparation

Before using the paid capability, the agent should make sure the user-side wallet and policy prep are complete:

1. Call `stablepay_runtime_status`
2. If no wallet exists, call `stablepay_create_local_wallet`
3. Call `stablepay_register_local_did`
4. Call `stablepay_configure_payment_limits`
5. Call `stablepay_build_payment_policy`

## Paid access behavior

1. Attempt the paid skill request.
2. If the backend returns HTTP `402 Payment Required`, explain that payment is required.
3. Ask the StablePay plugin to prepare or sign the payment challenge locally.
4. Only continue after the StablePay backend confirms the purchase.
5. If verification fails or payment is incomplete, do not continue.

## Current scope

This demo is intentionally limited:

- real X verification is still out of scope
- real Solana transfer is still out of scope
- OWS policy registration is represented today by a local OWS-ready policy manifest because the current Windows environment does not support the official OWS Node SDK directly

## Safety

- Never expose private keys or decrypted local state
- Never claim purchase success unless the backend confirms it
- Treat local payment limits as user protection, not as a replacement for backend validation
