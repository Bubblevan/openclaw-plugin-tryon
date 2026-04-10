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
openclaw plugins install clawhub:stablepay-openclaw-plugin
openclaw gateway restart
```

开发联调（本地源码）可用 `--link`，但不是新人默认路径。

命名说明（避免混淆）：

- ClawHub 安装 slug：`stablepay-openclaw-plugin`
- 插件 runtime id（manifest）：`stablepayai`

## 运行前准备

### 1) 启动 StablePay 后端

确保 `stablepayai-idl/docker-compose.infra.yml` 与 `docker-compose.services.yml` 已启动，`api-gateway` 可达 `http://127.0.0.1:28080`。

### 2) 准备 OWS 钱包

`ows-cli` / `wsl-ows` 模式不会代替你创建“可用 OWS 钱包”，你需要先有真实钱包：

```bash
ows wallet create --name "stablepay-agent"
ows wallet create --name "stablepay-seller"
ows wallet list
```

记录：

- 买家钱包名（如 `stablepay-agent`）
- 买家 Solana 地址（Base58）
- 卖家 Solana 地址（Base58，用于 `skill_did`）

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

当前发布线（`stablepay-openclaw-plugin` 包）使用的 runtime id 是 `stablepayai`。  
因此 `plugins.entries` 推荐直接使用 `stablepayai`（除非后续发布了新的 breaking package line）。

```json
{
  "plugins": {
    "entries": {
      "stablepayai": {
        "enabled": true,
        "config": {
          "backendBaseUrl": "http://127.0.0.1:28080",
          "feePayerSolanaAddress": "REPLACE_WITH_PLATFORM_HOTWALLET_SOLANA_PUBKEY",
          "solanaRpcUrl": "https://api.devnet.solana.com",
          "splTokenMintAddress": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
          "owsRuntime": "auto",
          "didRegisterPath": "/api/v1/did"
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
2. `stablepay_create_local_wallet`
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
2. `stablepay_create_local_wallet`：绑定买家钱包（`public_key` 必填于 `ows-cli/wsl-ows`）
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

## 工具清单（当前）

- 钱包/状态：`stablepay_runtime_status` `stablepay_create_local_wallet`
- DID：`stablepay_register_local_did`
- 支付策略：`stablepay_configure_payment_limits` `stablepay_build_payment_policy`
- 支付：`stablepay_pay_via_gateway` `stablepay_execute_paid_skill_demo`
- 签名：`stablepay_sign_message`
- 查询：`stablepay_query_balance` `stablepay_query_sales`

## 常见问题 / 排障

1) 为什么 `openclaw.json` 里提示 plugin id mismatch？
- 当前 package slug 是 `stablepay-openclaw-plugin`，但 runtime id 仍是 `stablepayai`（兼容已发布版本）。请在 `plugins.entries` 使用 `stablepayai`。

2) 为什么支付时报缺少 fee payer？
- 未配置 `feePayerSolanaAddress` 且未导出 `STABLEPAY_FEE_PAYER_SOL`。

3) 为什么我配了钱包还提示 `public_key` 缺失？
- 你在 `ows-cli` / `wsl-ows` 模式；该模式必须传 `public_key`（`ows wallet list` 的 Solana 地址）。

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
