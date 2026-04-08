# StablePay OpenClaw Plugin

OpenClaw plugin that handles the client-side wallet, signing, and payment-policy side of the StablePay flow.

## Verified state

`stablepay_runtime_status` confirmed working as of 2026-03-31:

```json
{
  "requested_driver": "auto",
  "active_driver": "ows-cli",
  "available_drivers": ["ows-cli", "wsl-ows"],
  "local_state_path": "/home/bubblevan/.stablepay-openclaw/stablepay-local-state.enc",
  "has_wallet": false,
  "wallet": null,
  "payment_config": null,
  "policy": null,
  "notes": [
    "OWS Node SDK could not be loaded in this environment. On the current Windows machine, the official package does not ship a win32 native binding yet."
  ]
}
```

## DID 与私钥模型（重要）

| API | 用途 | 私钥位置 |
|-----|------|----------|
| **`POST /api/v1/did`**（默认 `didRegisterPath`） | **契约主路径**（PRD/tech）；`stablepay_register_local_did` | 客户端 / OWS Vault；服务端只存公钥 |
| **`POST /api/v1/did/register`** | 与上一行**同一逻辑**的兼容别名 | 同上 |

服务端不生成、不托管用户私钥。路由说明见 [api-gateway/docs/did-flow.md](../api-gateway/docs/did-flow.md)。

## Runtime model

| Driver | When active | Notes |
|--------|------------|-------|
| `ows-sdk` | `@open-wallet-standard/core` 可加载 | In-process 签名（Linux/macOS 等） |
| `ows-rest` | 配置了 `owsRestBaseUrl` + `STABLEPAY_OWS_REST_API_KEY`（或自定义 env） | HTTP `SignMessageRequest` → hex `signature` |
| `ows-cli` / `wsl-ows` | `ows` 在 PATH 且可选用 | 子进程 `ows sign message --json` |
`auto` 优先级：`ows-sdk` →（若配置了 REST 且存在 API key）`ows-rest` → `ows-cli`。  
如果三者都不可用会直接报错（不再降级 fallback）。

WSL 端到端步骤见 [docs/ows-wsl-e2e.md](docs/ows-wsl-e2e.md)。

## Installation

### WSL (required — do not install from `/mnt/d/`)

OpenClaw blocks plugins installed from NTFS-mounted paths (`/mnt/d/`, `/mnt/c/`, etc.) because Windows NTFS shows `mode=777` in WSL and OpenClaw treats world-writable paths as untrusted.

Copy the plugin to a Linux-native path, build it, then install:

```bash
cp -r /mnt/d/mylab/stablepay/stablepay-openclaw-plugin ~/stablepay-openclaw-plugin
cd ~/stablepay-openclaw-plugin
chmod -R 755 .
npm install
npm run build          # compiles src/ → dist/
openclaw plugins install --link ~/stablepay-openclaw-plugin
openclaw gateway restart
```

After any source change, rebuild and reinstall:

```bash
cd ~/stablepay-openclaw-plugin
npm run build
openclaw plugins install --link ~/stablepay-openclaw-plugin
openclaw gateway restart
```

### Permanent fix (optional)

To avoid the copy and let OpenClaw accept `/mnt/d/` paths, configure WSL to mount with proper permissions:

```bash
sudo tee -a /etc/wsl.conf > /dev/null << 'EOF'

[automount]
options = "metadata,umask=022,fmask=111"
EOF
```

Then restart WSL from Windows PowerShell:

```powershell
wsl --shutdown
```

After that you can install directly from the Windows path.

## Required environment variable

Set `STABLEPAY_PLUGIN_MASTER_KEY` so the plugin can encrypt local state metadata (`stablepay-local-state.enc`).

```bash
# bash / WSL
export STABLEPAY_PLUGIN_MASTER_KEY="replace-with-a-long-random-secret"
```

```powershell
# PowerShell
$env:STABLEPAY_PLUGIN_MASTER_KEY = "replace-with-a-long-random-secret"
```

If this variable is not set, StablePay tools that persist state (including wallet binding) will fail.

Optional (only needed if you run a supported OWS SDK runtime):

```bash
export STABLEPAY_OWS_PASSPHRASE="..."
```

## Plugin config (`~/.openclaw/openclaw.json`)

All fields are optional. The plugin falls back to the defaults shown below if config is absent.

```json
{
  "plugins": {
    "entries": {
      "stablepay-mock-plugin": {
        "enabled": true,
        "config": {
          "backendBaseUrl": "http://127.0.0.1:28080",
          "verifyPageBaseUrl": "http://127.0.0.1:3000/verify",
          "owsRuntime": "auto",
          "walletNamePrefix": "stablepay",
          "didRegisterPath": "/api/v1/did",
          "owsRestBaseUrl": "",
          "owsRestSignPath": "/v1/sign/message",
          "owsRestWalletId": ""
        }
      }
    }
  }
}
```

`backendBaseUrl` defaults to `http://127.0.0.1:8080` if omitted（Docker 联调请改为 Gateway 端口，如 `28080`）。

## Tools

### Local wallet runtime (new)

| Tool | What it does |
|------|-------------|
| `stablepay_runtime_status` | Show active driver, wallet presence, state path, payment config, policy |
| `stablepay_create_local_wallet` | Create or bind an OWS wallet (OWS-only, no fallback runtime) |
| `stablepay_register_local_did` | POST the local public key to `backendBaseUrl/didRegisterPath` to create a backend DID record |
| `stablepay_configure_payment_limits` | Save single-purchase limit and auto-purchase threshold to local state |
| `stablepay_build_payment_policy` | Assemble a payment policy manifest from local wallet + limits |
| `stablepay_sign_message` | Sign gateway/business canonical payload through the active wallet provider (OWS first) |
| `stablepay_execute_paid_skill_demo` | Exercise `verify → 402 → OWS message signing → /api/v1/pay → retry → 200` |

## Test sequence

### Smoke test (run first)

```
Call stablepay_runtime_status and return only the structured result.
Call stablepay_create_local_wallet. Create one local StablePay wallet and show the returned address or wallet summary.
Call stablepay_runtime_status and summarize only the wallet-related fields.
```

Expected after `create_local_wallet`: `has_wallet: true`, `wallet` not null.

### A2 prep flow

```
Call stablepay_create_local_wallet. Create one local StablePay wallet.
Call stablepay_register_local_did for the current local wallet and return the backend response.
Call stablepay_configure_payment_limits. Set single purchase limit to 5 USDC and auto-purchase threshold to 1 USDC.
Call stablepay_build_payment_policy and return the generated policy manifest.
Call stablepay_sign_message. Sign the message: StablePay local signing smoke test.
```

### B demo flow (paid skill)

Start the demo backend first:

```bash
cd showmethemoney-skill/demo-backend
npm install && npm start
```

Then in OpenClaw:

```
Call stablepay_execute_paid_skill_demo and show the full payment flow result.
```

Expected chain: `verify → 402 Payment Required → OWS sign business + gateway canonical → /api/v1/pay → retry → 200 OK`.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `world-writable path (mode=777)` | Installing from `/mnt/d/` | Copy to `~/` first |
| `must have required property 'backendBaseUrl'` | Old `openclaw.plugin.json` with `"required": ["backendBaseUrl"]` | Pull latest; old schema is fixed |
| `stablepay_create_local_wallet` fails | `STABLEPAY_PLUGIN_MASTER_KEY` not set | Set the env var and restart gateway |
| `stablepay_register_local_did` fails | Wrong `backendBaseUrl` or `didRegisterPath` | Check plugin config and that api-gateway is running |
| `stablepay_sign_message` fails | Local runtime issue, not a backend issue | Check state file exists and key env var is correct |
| `stablepay_execute_paid_skill_demo` fails | demo-backend not running | Start `showmethemoney-skill/demo-backend` first |

## Development

```bash
npm install
npm run check   # TypeScript type check, no output
npm run build   # compile src/ → dist/, required before install
```

OpenClaw loads `dist/index.js` (compiled output). After every source change you need to rebuild and reinstall the plugin before the changes take effect in the gateway.
