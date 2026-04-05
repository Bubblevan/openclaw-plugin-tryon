# StablePay OpenClaw Plugin

OpenClaw plugin that handles the client-side wallet, signing, and payment-policy side of the StablePay flow.

## Verified state

`stablepay_runtime_status` confirmed working as of 2026-03-31:

```json
{
  "requested_driver": "auto",
  "active_driver": "local-dev",
  "available_drivers": ["local-dev"],
  "local_state_path": "/home/bubblevan/.stablepay-openclaw/stablepay-local-state.enc",
  "has_wallet": false,
  "wallet": null,
  "payment_config": null,
  "policy": null,
  "notes": [
    "OWS Node SDK could not be loaded in this environment. On the current Windows machine, the official package does not ship a win32 native binding yet.",
    "The plugin will use a local AES-256-GCM encrypted state file as the current development fallback. This is suitable for local OpenClaw demos, but it is not the final OWS custody model."
  ]
}
```

## DID 与私钥模型（重要）

| API | 用途 | 私钥位置 |
|-----|------|----------|
| **`POST /api/v1/did/register`**（`stablepay_register_local_did`） | **推荐** | 客户端 / OWS Vault；服务端只存公钥 |
| **`POST /api/v1/did`**（`stablepay_create_mock_wallet`） | 服务端托管演示 | 加密写入 did-service 数据库；响应**不含**私钥 |

生产与 Agent 场景请始终使用 **register** 路径。Gateway 可通过 `features.allow_did_create: false` 关闭托管创建（见 [api-gateway/docs/did-flow.md](../api-gateway/docs/did-flow.md)）。

## Runtime model

| Driver | When active | Notes |
|--------|------------|-------|
| `ows-sdk` | `@open-wallet-standard/core` 可加载 | In-process 签名（Linux/macOS 等） |
| `ows-rest` | 配置了 `owsRestBaseUrl` + `STABLEPAY_OWS_REST_API_KEY`（或自定义 env） | HTTP `SignMessageRequest` → hex `signature` |
| `ows-cli` / `wsl-ows` | `ows` 在 PATH 且可选用 | 子进程 `ows sign message --json` |
| `local-dev` | 兜底 | AES-256-GCM 加密状态文件 `~/.stablepay-openclaw/` |

`auto` 优先级：`ows-sdk` →（若配置了 REST 且存在 API key）`ows-rest` → `ows-cli` → `local-dev`。Windows 上常无 OWS 原生绑定，会落到 `local-dev` 或你在 WSL 里用 `ows-cli`。

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

Set `STABLEPAY_PLUGIN_MASTER_KEY` before using the local wallet runtime. The plugin uses this to derive the AES-256-GCM key for `stablepay-local-state.enc`.

```bash
# bash / WSL
export STABLEPAY_PLUGIN_MASTER_KEY="replace-with-a-long-random-secret"
```

```powershell
# PowerShell
$env:STABLEPAY_PLUGIN_MASTER_KEY = "replace-with-a-long-random-secret"
```

If this variable is not set, `stablepay_create_local_wallet` will fail.

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
          "didRegisterPath": "/api/v1/did/register",
          "allowLegacyDidCreateFallback": false,
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
| `stablepay_create_local_wallet` | Generate an Ed25519 keypair, encrypt and save to local state file |
| `stablepay_register_local_did` | POST the local public key to `backendBaseUrl/didRegisterPath` to create a backend DID record |
| `stablepay_configure_payment_limits` | Save single-purchase limit and auto-purchase threshold to local state |
| `stablepay_build_payment_policy` | Assemble a payment policy manifest from local wallet + limits |
| `stablepay_sign_message` | Sign a message with the local private key (key never leaves the state file) |
| `stablepay_execute_paid_skill_demo` | Exercise the `verify → 402 → pay → retry → 200` chain against `showmethemoney-skill/demo-backend` |

### Legacy mock tools (A1 downgraded flow)

| Tool | What it does |
|------|-------------|
| `stablepay_create_mock_wallet` | POST to `POST /api/v1/did` and return DID + wallet address (no X verification, no reward) |
| `stablepay_generate_verify_link` | Build a `verify?did=...` URL for manual testing |
| `stablepay_seed_mock_tweet` | Seed a mock tweet record for X verification testing |
| `stablepay_verify_x_mock` | Submit mock X verification |
| `stablepay_query_balance` | Query USDC balance via `GET /api/v1/balance` |
| `stablepay_get_verify_status` | Check X verification status |

## Test sequence

### Smoke test (run first)

```
Call stablepay_runtime_status and return only the structured result.
Call stablepay_create_local_wallet. Create one local StablePay wallet and show the returned address or wallet summary.
Call stablepay_runtime_status and summarize only the wallet-related fields.
```

Expected after `create_local_wallet`: `has_wallet: true`, `wallet` not null.

### A1 downgraded flow (DID creation only, no X verification)

```
Call stablepay_create_mock_wallet and show the returned DID and wallet address.
```

Hits `POST /api/v1/did` on api-gateway → did-service. No X verification or USDC reward step.

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

Expected chain: `verify → 402 Payment Required → sign + pay → retry → 200 OK`.

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
