# StablePay OpenClaw Plugin

StablePay 的 OpenClaw 插件：在客户端完成 OWS 钱包签名与 402 支付接管，驱动 `api-gateway` 的真实支付链路。

## 项目简介

- 默认网关口径：`http://127.0.0.1:28080`
- 真实链路：`verify -> 402 -> 构造部分签名交易 -> /api/v1/pay -> 重试`
- 插件工具可直接在 `openclaw tui` 对话里调用，不需要额外 shell 脚本

## 当前能力边界

- 已覆盖买家侧主链路：本地钱包映射、DID 注册、限额、支付接管、余额查询。
- 已提供卖家侧销售查询：`stablepay_query_sales`（走 `/api/v1/sales`）。
- X 相关工具仍是可选演示能力，不是本次支付闭环的必经路径。
- 收益（revenue）若走内部端口接口，当前未在插件中统一封装（见 `showmethemoney-skill/demo-backend` 代理接口）。

## 安装方式（ClawHub / OpenClaw）

推荐安装命令（统一口径）：

```bash
openclaw plugins install clawhub:stablepay-agentpay-dev
openclaw gateway restart
```

开发联调（本地源码）可用 `--link`，但不是新人默认路径。

命名说明（避免混淆）：

- ClawHub 安装 slug：`stablepay-agentpay-dev`
- 插件 runtime id（manifest）：`stablepay-agentpay-dev`

## 运行前准备

### 1) 启动 StablePay 后端

确保 `stablepayai-idl/docker-compose.infra.yml` 与 `docker-compose.services.yml` 已启动，`api-gateway` 可达 `http://127.0.0.1:28080`。

### 2) 准备 OWS 钱包

你需要在 OWS 侧先有**买家**钱包（`ows wallet create` 或已导入的 vault钱包）。插件侧两条入口语义不同：

| 工具 | 何时使用 |
|------|----------|
| `stablepay_create_local_wallet` | **新建**钱包：`ows-sdk` 会调 `createWallet`；CLI/REST 路径则是「绑定名+公钥」但不验 challenge。 |
| `stablepay_bind_existing_wallet` | **只绑定已有** vault/CLI/REST 钱包：按 `wallet_name` + `public_key`，现场签 challenge 并用 Ed25519 验签通过后才写入本地 state，避免名/钥错配。 |

```bash
ows wallet create --name "stablepay-agent"
ows wallet create --name "stablepay-seller"
ows wallet list
```

记录：

- 买家钱包名（如 `stablepay-agent`）
- 买家 Solana 地址（Base58）
- 卖家 Solana 地址（Base58，用于 `skill_did`）

已有买家钱包、且用 `ows-sdk` 时，推荐用 **`stablepay_bind_existing_wallet`**，不要用 `create` 再生成一个新钱包。

### 3) 设置环境变量

| 变量名 | 是否必需 | 作用 | 典型场景 |
|---|---|---|---|
| `STABLEPAY_PLUGIN_MASTER_KEY` | 必需 | 加密插件本地状态文件 | 所有本地钱包/限额/策略工具 |
| `STABLEPAY_FEE_PAYER_SOL` | 真实支付必需（二选一） | 平台 hotwallet 公钥地址（fee payer） | 未在 `openclaw.json` 填 `feePayerSolanaAddress` 时 |
| `STABLEPAY_OWS_PASSPHRASE` | 常见可选 | OWS CLI/SDK 签名解锁口令 | 无人值守签名、避免每次交互输入 |
| `STABLEPAY_OWS_REST_API_KEY` | 仅 `ows-rest` 必需 | OWS REST 签名服务 token | `owsRuntime=ows-rest` |

**fee payer 说明（重点）**

- 插件仓库**没有内置** hotwallet 公钥。
- 真实支付需要 fee payer 地址（二选一）：
  - 插件配置 `feePayerSolanaAddress`
  - 环境变量 `STABLEPAY_FEE_PAYER_SOL`
- 这里只是**公钥地址**，不是私钥。私钥仍只在服务端（`blockchain-adapter`）。
- 客户端必须知道 fee payer 公钥，是因为构造 Solana 交易 message 时必须包含 `feePayer` 字段。
- 优先级：`STABLEPAY_FEE_PAYER_SOL` > `feePayerSolanaAddress`。

## OpenClaw 配置示例（`~/.openclaw/openclaw.json`）

当前发布线（`stablepay-agentpay-dev` 包）使用的 runtime id 是 `stablepay-agentpay-dev`。  
因此 `plugins.entries` 推荐直接使用 `stablepay-agentpay-dev`。

```json
{
  "plugins": {
    "entries": {
      "stablepay-agentpay-dev": {
        "enabled": true,
        "config": {
          "backendBaseUrl": "http://127.0.0.1:28080",
          "feePayerSolanaAddress": "REPLACE_WITH_PLATFORM_HOTWALLET_SOLANA_PUBKEY",
          "solanaRpcUrl": "https://api.devnet.solana.com",
          "splTokenMintAddress": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
          "owsRuntime": "auto",
          "didRegisterPath": "/api/v1/did/register"
        }
      }
    }
  }
}
```

默认值与源码一致：

- `backendBaseUrl` 默认 `http://127.0.0.1:28080`
- `solanaRpcUrl` 默认 `https://api.devnet.solana.com`
- `splTokenMintAddress` 默认 devnet USDC `4zMMC...`

## OWS Runtime 说明

| runtime | 含义 | 前置条件 |
|---|---|---|
| `auto` | 按优先级自动选择 | `ows-sdk -> ows-rest(有 token) -> ows-cli` |
| `ows-sdk` | 进程内 SDK 签名 | 环境可加载 `@open-wallet-standard/core` |
| `ows-cli` | 调本机 `ows` 子进程签名 | PATH 中可执行 `ows`，且你已有钱包 |
| `wsl-ows` | 与 `ows-cli` 同路径语义 | 仍依赖本机 `ows` |
| `ows-rest` | 调 HTTP 签名服务 | 配 `owsRestBaseUrl` + API key |

`ows-cli` / `wsl-ows` 真实前提：

- 本机已安装 OWS CLI
- 先用 `ows wallet create` / `ows wallet list` 拿到钱包与 Solana 地址
- 调 `stablepay_create_local_wallet` 时传 `public_key`（`ows wallet list` 里的 Solana Base58 地址）

## 联调角色模型（买家 / 卖家 / 热钱包）

1. 买家钱包（Agent）
   - 业务签名
   - 交易 message 签名
   - 对应本地用户 DID
2. 卖家钱包（Skill）
   - 对应 `skill_did`
   - 收款地址
   - 建议每个新商品/联调案例单独准备
3. 平台热钱包（Hotwallet）
   - 仅 fee payer（补 gas）
   - 私钥只在服务端
   - 客户端仅知道公钥地址

> 联调时自己要不要额外持有卖家 OWS 钱包？  
建议要。因为 `skill_did` 需要真实对应一个卖家地址，使用真实卖家钱包最不容易与后端验签/验证口径冲突。

## 快速联调流程（无 skill backend）

只验证插件与网关支付 API：

1. `stablepay_runtime_status`
2. `stablepay_bind_existing_wallet`（已有 OWS 钱包）或 `stablepay_create_local_wallet`（新建）
3. `stablepay_register_local_did`
4. `stablepay_configure_payment_limits`
5. `stablepay_pay_via_gateway`（传 `skill_did` / `skill_name` / `price` / `currency`）

## 完整联调流程（带 skill backend）

### 进入 `openclaw tui` 前

```bash
# 1) 启动 demo backend
cd /mnt/d/MyLab/StablePay/showmethemoney-skill/demo-backend
npm install
npm start

# 2) 设置插件运行环境
export STABLEPAY_PLUGIN_MASTER_KEY="replace-with-a-long-random-secret"
export STABLEPAY_FEE_PAYER_SOL="<platform_hotwallet_solana_pubkey>"
# 可选
export STABLEPAY_OWS_PASSPHRASE="<ows-passphrase-or-token>"

# 3) 重启网关后再进入 tui
openclaw gateway restart
openclaw tui
```

### TUI 推荐工具顺序

1. `stablepay_runtime_status`：先确认 runtime 与本地状态
2. 买家钱包：**已有**用 `stablepay_bind_existing_wallet`（`wallet_name` + `public_key`，可选 `runtime`）；**新建**用 `stablepay_create_local_wallet`（`ows-cli/wsl-ows` 仍需 `public_key`）
3. `stablepay_register_local_did`：登记 DID
4. `stablepay_configure_payment_limits`：设置限额
5. 路径 A：`stablepay_pay_via_gateway`（直接触发 402 支付链路）
6. 路径 B：`stablepay_execute_paid_skill_demo`（先调 demo backend `/execute`，402 后插件接管支付）
7. 若超阈值：带 `confirm_over_threshold=true` 再执行一次第 5/6 步

## Demo skill / demo-backend

- Skill 文档：`../showmethemoney-skill/SKILL.md`
- Demo backend：`../showmethemoney-skill/demo-backend/README.md`

联调原则：

- `skill_did` 应来自卖家钱包 DID（`did:solana:<seller_pubkey>`）
- 后端在未购买时返回 `402`
- 插件完成支付后再重试后端请求

## 工具清单

`registerTool` 的 **optional** 仅保留给 X / Mock 验证相关工具；其余工具默认始终向 OpenClaw 暴露（无需再在 `tools.allow` 里单独放行查询类工具）。

| 工具名 | Optional | 用途说明 |
|--------|----------|----------|
| `stablepay_runtime_status` | 否 | 查看插件 runtime、本地状态路径、当前钱包、OWS/本地驱动可用性；不含链上或网关余额。 |
| `stablepay_create_local_wallet` | 否 | **新建**买家侧钱包：`ows-sdk` 调 `createWallet`；CLI/REST 为「名+公钥」写入 state（无 challenge 验签）。 |
| `stablepay_bind_existing_wallet` | 否 | **绑定已有** OWS 钱包：`wallet_name` + `public_key`；`ows-sdk` 用 `getWallet` 核对地址；全体路径签 challenge 并验 Ed25519 后才落盘。`ows-rest` 需 `ows_wallet_id`（或配置默认）。 |
| `stablepay_register_local_did` | 否 | 将当前本地钱包公钥登记到网关（默认 `POST /api/v1/did/register`），拿到 `backend_did` 供后续支付与鉴权。 |
| `stablepay_configure_payment_limits` | 否 | 写入本地加密状态：单次购买上限、自动购买阈值等，支付前策略校验用。 |
| `stablepay_build_payment_policy` | 否 | 根据当前限额与钱包状态生成本地 OWS 向的支付策略 manifest（后续 OWS 策略注册接入点）。 |
| `stablepay_sign_message` | 否 | 用当前钱包对消息签名；`append_timestamp_nonce=true` 时对齐网关 canonical + 时间戳 + nonce 的签法。 |
| `stablepay_execute_paid_skill_demo` | 否 | 调 demo skill 的 `execute` URL；遇 HTTP 402 时走 `settlePaymentViaGateway`（预签 raw tx 等）完成 `POST /api/v1/pay`，再轮询重试 execute。 |
| `stablepay_pay_via_gateway` | 否 | 直接 `GET /api/v1/pay/require`；402 时同样经 `settlePaymentViaGateway` 完成网关支付，无需外部 shell。 |
| `stablepay_query_balance` | 否 | 经网关 `GET /api/v1/balance`（`agent_did`，失败时回退 `agent=`）查 StablePay 后端口径余额，**不是** Solana RPC 原生查询。 |
| `stablepay_query_sales` | 否 | 经网关 `GET /api/v1/sales` 按 `skill_did` 查卖家侧销售数据。 |
| `stablepay_generate_verify_link` | 是 | 生成验证页链接占位（X 验证可能未启用）。 |
| `stablepay_seed_mock_tweet` | 是 | 向 mock 后端写入假推文，供本地 X 验证演示。 |
| `stablepay_verify_x_mock` | 是 | 调 mock X 验证 API（DID + 推文 URL）。 |
| `stablepay_get_verify_status` | 是 | 查询某 DID 是否已完成 X 验证（主注册链路可跳过 X）。 |

## 常见问题 / 排障

1) 为什么 `openclaw.json` 里提示 plugin id mismatch？
- 当前 package slug 是 `stablepay-agentpay-dev`，runtime id 是 `stablepay-agentpay-dev`。请在 `plugins.entries` 使用 `stablepay-agentpay-dev`。

2) 为什么支付时报缺少 fee payer？
- 未配置 `feePayerSolanaAddress` 且未导出 `STABLEPAY_FEE_PAYER_SOL`。

3) 为什么我配了钱包还提示 `public_key` 缺失？
- 你在 `ows-cli` / `wsl-ows` 模式；该模式必须传 `public_key`（`ows wallet list` 的 Solana 地址）。

3b) `create` 和 `bind` 怎么选？
- 要在 vault 里**新造**密钥用 `stablepay_create_local_wallet`（SDK）或先在 CLI `ows wallet create` 再按需绑定。
- vault 里**已经有**钱包、且希望名与公钥一致并可验签，用 `stablepay_bind_existing_wallet`。

4) 为什么 `ows-cli` / `wsl-ows` 要先自己准备 OWS 钱包？
- 插件做的是“绑定并使用”已有钱包，不替代 OWS 全生命周期管理。

5) 为什么后端 skill 一直 402？
- `skill_did`、`price`、`currency` 与后端挑战不一致，或支付未成功写入验证侧。

6) 为什么我服务启动了插件还连不上？
- 先确认 `backendBaseUrl` 是否 `28080`，再确认容器端口映射与网关健康。

7) 为什么历史文档有人写 8080？
- 旧口径。当前仓库默认与推荐统一为 `28080`。

8) 卖家钱包和热钱包区别？
- 卖家钱包收款；热钱包只做 fee payer。

9) 为什么这里只配 hotwallet 公钥不是私钥？
- 客户端只需公钥参与交易消息构造；私钥必须只在服务端保存。

10) 重启网关报 `ajv implementation error` / `unknown format "uri"`？
- 已移除插件 schema 的 `format: "uri"` 约束以兼容当前 OpenClaw/AJV 组合；升级后重新安装插件并重启网关。

## 开发

```bash
npm install
npm run check
npm run build
```

构建产物在 `dist/`。修改源码后需重新 `npm run build` 并重新安装插件。
