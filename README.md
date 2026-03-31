# StablePay OpenClaw Plugin

This plugin turns OpenClaw into the local wallet and signing side of the StablePay flow.

It now supports two layers of capability:

- `local wallet runtime`: create a local Solana DID wallet, keep state encrypted on disk, configure payment limits, generate an OWS-ready payment policy manifest, and sign messages locally
- `legacy mock tools`: keep the earlier mock X verification helpers for the downgraded A1 demo

## What changed

The previous version of this plugin was mostly a mock X verification helper. The current direction is aligned with the repo PRD and tech docs:

- private key material should stay on the client side
- local state should be AES-256 encrypted
- OpenClaw should become the place where wallet creation, local limits, policy preparation, and signing happen
- backend services should keep doing DID verification, replay protection, amount checks, and async purchase recording

## Runtime model

The plugin now uses a runtime abstraction:

- `ows-sdk`
  Uses `@open-wallet-standard/core` when the platform supports it.
- `local-dev`
  Current development fallback. On this Windows machine, the official OWS Node SDK does not ship a native win32 binding, so the plugin automatically falls back to a local encrypted dev runtime.

The `local-dev` runtime is intended for local demos only. It lets us keep moving now without pretending the Windows environment already has full OWS SDK support.

## New tools

- `stablepay_runtime_status`
- `stablepay_create_local_wallet`
- `stablepay_register_local_did`
- `stablepay_configure_payment_limits`
- `stablepay_build_payment_policy`
- `stablepay_sign_message`
- `stablepay_execute_paid_skill_demo`

Legacy mock tools remain available:

- `stablepay_create_mock_wallet`
- `stablepay_generate_verify_link`
- `stablepay_seed_mock_tweet`
- `stablepay_verify_x_mock`
- `stablepay_query_balance`
- `stablepay_get_verify_status`

## Required environment

Set a master key before using the local wallet runtime:

```powershell
$env:STABLEPAY_PLUGIN_MASTER_KEY = "replace-with-a-long-random-secret"
```

Optional:

```powershell
$env:STABLEPAY_OWS_PASSPHRASE = "replace-if-you-run-ows-sdk-on-a-supported-platform"
```

## Suggested plugin config

```json
{
  "plugins": {
    "entries": {
      "stablepay-mock-plugin": {
        "enabled": true,
        "config": {
          "backendBaseUrl": "http://127.0.0.1:8080",
          "verifyPageBaseUrl": "http://127.0.0.1:3000/verify",
          "owsRuntime": "auto",
          "walletNamePrefix": "stablepay",
          "didRegisterPath": "/api/v1/did/register",
          "allowLegacyDidCreateFallback": false
        }
      }
    }
  }
}
```

## Local demo flow

### A1 downgraded flow

1. `stablepay_create_local_wallet`
2. `stablepay_register_local_did`
3. optional `stablepay_generate_verify_link`
4. keep X verification and real reward skipped for now

### A2 prep flow

1. `stablepay_create_local_wallet`
2. `stablepay_register_local_did`
3. `stablepay_configure_payment_limits`
4. `stablepay_build_payment_policy`
5. `stablepay_sign_message`

### B demo flow

1. `stablepay_create_local_wallet`
2. `stablepay_register_local_did`
3. `stablepay_configure_payment_limits`
4. start `showmethemoney-skill/demo-backend`
5. `stablepay_execute_paid_skill_demo`

This lets OpenClaw exercise the developer-side `verify -> 402 -> pay -> retry -> 200` chain without needing real X verification or real Solana first.

## Notes on OWS

- The architecture is OWS-first.
- The current Windows machine is not yet a fully supported OWS SDK runtime.
- The plugin therefore prepares the right boundaries now:
  - local encrypted state
  - wallet runtime abstraction
  - policy manifest generation
  - local signing entrypoint
- When the environment supports OWS SDK or CLI directly, the plugin can switch from `local-dev` toward a true OWS runtime without rethinking the whole OpenClaw integration.

## Development

```bash
npm install
npm run check
```
