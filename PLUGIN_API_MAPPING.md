# StablePay OpenClaw Plugin - API Gateway 接口映射文档

本文档详细说明 OpenClaw Plugin 中每个工具方法与后端 API Gateway 接口的对应关系。

---

## 工具方法概览

Plugin 共注册 **15 个工具方法**（其中 4 个为可选）：

| 类别 | 工具名称 | 必需 | 对应 API 接口 |
|------|---------|------|--------------|
| 运行时管理 | `stablepay_runtime_status` | ✅ | 本地状态查询 |
| 钱包管理 | `stablepay_create_local_wallet` | ✅ | 本地钱包创建 |
| 钱包管理 | `stablepay_bind_existing_wallet` | ✅ | 本地钱包绑定 |
| DID 管理 | `stablepay_register_local_did` | ✅ | `POST /api/v1/did/register` |
| 支付配置 | `stablepay_configure_payment_limits` | ✅ | 本地状态存储 |
| 支付配置 | `stablepay_build_payment_policy` | ✅ | 本地策略生成 |
| 签名工具 | `stablepay_sign_message` | ✅ | OWS 本地签名 |
| 支付执行 | `stablepay_execute_paid_skill_demo` | ✅ | `GET /api/v1/pay/require` + `POST /api/v1/pay` |
| 支付执行 | `stablepay_pay_via_gateway` | ✅ | `GET /api/v1/pay/require` + `POST /api/v1/pay` |
| 查询工具 | `stablepay_query_balance` | ✅ | `GET /api/v1/balance` |
| 查询工具 | `stablepay_query_sales` | ✅ | `GET /api/v1/sales` |
| 验证工具 | `stablepay_generate_verify_link` | ❌ | 本地链接生成 |
| 验证工具 | `stablepay_seed_mock_tweet` | ❌ | `POST /api/v1/mock/twitter/tweets` |
| 验证工具 | `stablepay_verify_x_mock` | ❌ | `POST /verify-twitter` |
| 验证工具 | `stablepay_get_verify_status` | ❌ | `GET /verify` |

---

## 详细映射说明

### 1. 运行时管理

#### `stablepay_runtime_status`

**描述**: 显示 StablePay 运行时状态、配置路径、活跃钱包和 OWS 运行时可用性。

**调用方式**: 纯本地操作，无后端 API 调用

**涉及代码**: `runtime.ts#getStatus()`

**返回数据**:
```typescript
{
  requested_driver: string;      // 请求的驱动
  active_driver: string;         // 实际使用的驱动
  available_drivers: string[];   // 可用驱动列表
  local_state_path: string;      // 本地状态文件路径
  has_wallet: boolean;           // 是否有钱包
  wallet: {
    wallet_id: string;
    wallet_name: string;
    did: string;
    wallet_address: string;
    runtime_driver: string;
    backend_did: string;         // 后端注册的 DID
  } | null;
  payment_config: PaymentConfig | null;
  policy: PolicyInfo | null;
  notes: string[];               // 运行时提示信息
}
```

---

### 2. 钱包管理

#### `stablepay_create_local_wallet`

**描述**: 创建新的 StablePay/OWS 钱包。

**调用方式**: 本地 OWS SDK/CLI/REST 调用，无后端 API

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `user_id` | string | 否 | 用户标识，用于生成钱包名 |
| `user_type` | "agent" \| "developer" | 否 | 用户类型 |
| `wallet_name` | string | 否 | 显式指定钱包名 |
| `runtime` | "ows-sdk" \| "ows-cli" \| "wsl-ows" \| "ows-rest" | 否 | 指定运行时 |
| `public_key` | string | 条件 | ows-cli/wsl-ows/ows-rest 必需 |
| `ows_wallet_id` | string | 条件 | ows-rest 必需 |

**运行时检测顺序**:
1. `ows-sdk` - Node.js SDK（如果可用）
2. `ows-rest` - HTTP REST API（如果配置了 baseUrl）
3. `ows-cli` - 命令行工具（如果在 PATH 中）

---

#### `stablepay_bind_existing_wallet`

**描述**: 绑定已存在的 OWS 钱包（不创建新钱包）。

**调用方式**: 本地 OWS 操作 + 签名验证挑战

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `wallet_name` | string | ✅ | 现有 OWS 钱包名 |
| `public_key` | string | ✅ | 预期的 Solana 地址 |
| `runtime` | RuntimeDriver | 否 | 运行时类型 |
| `ows_wallet_id` | string | 条件 | ows-rest 必需 |

**验证流程**:
1. 获取钱包信息（通过 SDK/CLI/REST）
2. 验证 `public_key` 与钱包地址匹配
3. 生成随机挑战字符串
4. 使用钱包签名挑战
5. Ed25519 验证签名

---

### 3. DID 管理

#### `stablepay_register_local_did`

**描述**: 将本地钱包注册到 StablePay 后端。

**对应 API**: `POST /api/v1/did/register`

**认证方式**: 无需认证（首次注册）

**请求参数映射**:
| Plugin 参数 | API 参数 | 说明 |
|------------|---------|------|
| `user_type` | `user_type` | "agent" 或 "developer" |
| `wallet.wallet_address` | `public_key` | Solana 公钥 |
| `wallet.wallet_address` | `wallet_address` | 钱包地址 |
| `wallet.wallet_id` | `wallet_id` | 钱包 ID |
| `wallet.wallet_name` | `wallet_name` | 钱包名称 |
| `runtime.sign_runtime` | `metadata.sign_runtime` | 签名运行时 |

**响应数据**: `DIDRecord`
```typescript
{
  did: string;              // 后端分配的唯一 DID
  wallet_address: string;
  wallet_id?: string;
  wallet_name?: string;
  created_at?: string;
}
```

**代码位置**: `client.ts#registerLocalDid()` → `POST /api/v1/did/register`

---

### 4. 支付配置

#### `stablepay_configure_payment_limits`

**描述**: 配置本地支付限额。

**调用方式**: 纯本地状态存储，无后端 API

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `single_purchase_limit_usdc` | number | ✅ | 单笔购买上限 |
| `auto_purchase_threshold_usdc` | number | ✅ | 自动购买阈值 |
| `currency` | "USDC" \| "USDT" | 否 | 默认 USDC |

**验证规则**:
- `single_purchase_limit_usdc > 0`
- `auto_purchase_threshold_usdc >= 0`
- `auto_purchase_threshold_usdc <= single_purchase_limit_usdc`

---

#### `stablepay_build_payment_policy`

**描述**: 生成本地 OWS 就绪的支付策略清单。

**调用方式**: 本地文件生成，无后端 API

**参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| `skill_did` | string | Skill DID |
| `recipient_wallet` | string | 接收方钱包 |
| `currency` | "USDC" \| "USDT" | 币种 |
| `purpose` | string | 用途说明 |
| `expires_at` | string | ISO 过期时间 |
| `owner_or_agent` | "owner" \| "agent" | 策略所有者 |

**生成文件**: `{localStateDir}/policies/{policy_id}.json`

---

### 5. 签名工具

#### `stablepay_sign_message`

**描述**: 使用本地钱包签名消息。

**调用方式**: 本地 OWS 签名，无后端 API

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `message` | string | ✅ | 待签名消息 |
| `chain` | string | 否 | 链类型，默认 "solana" |
| `timestamp` | string | 否 | 自定义时间戳 |
| `nonce` | string | 否 | 自定义 nonce |
| `append_timestamp_nonce` | boolean | 否 | 是否追加时间戳和 nonce |

**签名数据构造**:
```
如果 append_timestamp_nonce = true:
  payload = message + timestamp + nonce
否则:
  payload = message
```

---

### 6. 支付执行

#### `stablepay_execute_paid_skill_demo`

**描述**: 调用演示 Skill 后端，处理 402 支付流程。

**对应 API**: 
1. 商家后端 `GET {execute_url}?agent_did={did}`
2. `GET /api/v1/pay/require` (如果返回 402)
3. `POST /api/v1/pay` (支付提交)

**完整流程**:
```
1. GET {execute_url}?agent_did={agent_did}
   ↓
2. 如果 status === 200: 返回已购买结果
   ↓
3. 如果 status === 402: 
   a. 提取 payment_requirement
   b. 检查本地支付限额
   c. 构建 SPL 转账交易
   d. OWS 签名交易
   e. POST /api/v1/pay 提交支付
   ↓
4. 轮询等待支付确认
   ↓
5. 重试 GET {execute_url}
```

**参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| `execute_url` | string | 商家后端地址，默认 `http://127.0.0.1:8787/execute` |
| `retry_attempts` | number | 支付后重试次数，默认 6 |
| `retry_delay_ms` | number | 重试间隔，默认 1500ms |
| `confirm_over_threshold` | boolean | 是否确认超额支付 |

---

#### `stablepay_pay_via_gateway`

**描述**: 直接向 StablePay Gateway 发起支付。

**对应 API**:
1. `GET /api/v1/pay/require`
2. `POST /api/v1/pay`

**完整流程**:
```
1. GET /api/v1/pay/require?skill_did=xxx&agent_did=xxx&skill_name=xxx&price=xxx&currency=xxx
   ↓
2. 如果 status === 200: 返回已购买
   ↓
3. 如果 status === 402:
   a. 提取 payment_requirement
   b. 检查本地限额
   c. 构建并签名交易
   d. POST /api/v1/pay
```

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `skill_did` | string | ✅ | Skill DID |
| `skill_name` | string | ✅ | Skill 名称 |
| `price` | string | ✅ | 价格，如 "12.00" |
| `currency` | "USDC" \| "USDT" | 否 | 币种 |
| `message` | string | 否 | 支付提示 |
| `confirm_over_threshold` | boolean | 否 | 确认超额支付 |

**API 请求映射**:

`GET /api/v1/pay/require` 查询参数:
| 参数 | 来源 |
|------|------|
| `skill_did` | `params.skill_did` |
| `agent_did` | `status.wallet.backend_did` |
| `skill_name` | `params.skill_name` |
| `price` | `params.price` |
| `currency` | `params.currency ?? pc.currency` |
| `message` | `params.message` |

`POST /api/v1/pay` 请求体:
| 参数 | 来源 |
|------|------|
| `agent_did` | 运行时状态 |
| `skill_did` | 402 响应中的 `skill_did` |
| `amount` | 402 响应中的 `price` |
| `currency` | 402 响应中的 `currency` |
| `signature` | 业务签名 |
| `timestamp` | 当前时间戳 |
| `nonce` | 随机生成 |
| `signed_tx_base64` | OWS 签名的交易 |

---

### 7. 查询工具

#### `stablepay_query_balance`

**描述**: 查询 Agent 余额。

**对应 API**: `GET /api/v1/balance`

**认证方式**: DID 签名认证

**请求头生成**: `buildGatewayDidAuthHeaders()`

**请求参数**:
| 参数 | 来源 |
|------|------|
| `agent_did` / `agent` | 传入的 `did` 参数 |

**代码位置**: `client.ts#getBalance()`

---

#### `stablepay_query_sales`

**描述**: 查询 Skill 销售数据。

**对应 API**: `GET /api/v1/sales`

**认证方式**: DID 签名认证

**请求参数**:
| 参数 | 来源 |
|------|------|
| `skill_did` | 传入的 `skill_did` 参数 |

**代码位置**: `client.ts#getSales()`

---

### 8. 验证工具（可选）

#### `stablepay_generate_verify_link`

**描述**: 生成验证页面链接。

**调用方式**: 本地 URL 构造，无后端 API

---

#### `stablepay_seed_mock_tweet`

**描述**: 注入 Mock Twitter 数据用于测试。

**对应 API**: `POST /api/v1/mock/twitter/tweets`

**参数**:
| 参数 | 类型 | 必填 |
|------|------|------|
| `tweet_url` | string | ✅ |
| `text` | string | ✅ |
| `is_public` | boolean | 否 |

---

#### `stablepay_verify_x_mock`

**描述**: Mock X/Twitter 验证。

**对应 API**: `POST /verify-twitter`

**参数**:
| 参数 | 类型 | 必填 |
|------|------|------|
| `did` | string | ✅ |
| `tweet_url` | string | ✅ |

---

#### `stablepay_get_verify_status`

**描述**: 查询 X 验证状态。

**对应 API**: `GET /verify?did={did}`

---

## 核心类型定义

### PluginConfig

```typescript
type PluginConfig = {
  backendBaseUrl?: string;           // API Gateway 地址
  feePayerSolanaAddress?: string;    // Gas 费代付地址
  solanaRpcUrl?: string;             // Solana RPC
  splTokenMintAddress?: string;      // USDC/USDT 合约地址
  verifyPageBaseUrl?: string;        // 验证页面地址
  requestTimeoutMs?: number;         // 请求超时
  localStatePath?: string;           // 本地状态路径
  owsRuntime?: RuntimeDriver;        // OWS 运行时类型
  owsRestBaseUrl?: string;           // OWS REST API 地址
  pluginDebug?: boolean;             // 调试模式
}
```

### 运行时驱动类型

```typescript
type RuntimeDriver = 
  | "auto"      // 自动检测
  | "ows-sdk"   // OWS Node.js SDK
  | "ows-cli"   // OWS CLI 命令行
  | "wsl-ows"   // WSL 中的 OWS
  | "ows-rest"; // OWS HTTP REST API
```

---

## 错误处理

### StablePayHttpError

所有 API 调用失败都会抛出此错误：

```typescript
class StablePayHttpError extends Error {
  readonly status: number;      // HTTP 状态码
  readonly payload?: unknown;   // 错误响应体
}
```

### 常见错误码

| 错误码 | 说明 | 常见原因 |
|--------|------|---------|
| `10001` | 参数无效 | 缺少必填参数或格式错误 |
| `10004` | 签名验证失败 | DID 签名不正确或过期 |
| `20001` | 余额不足 | 钱包余额不足以支付 |
| `20003` | 区块链网络错误 | 链上交易失败 |
| `30001` | 内部服务器错误 | 服务端异常 |
| `30004` | 限流 | 请求频率过高 |

---

## 本地状态存储

Plugin 使用加密本地状态文件存储：

**位置**: `~/.config/openclaw/stablepay/stablepay-state.encrypted`

**存储内容**:
```typescript
type LocalPluginState = {
  version: 1;
  wallet?: WalletState;           // 钱包信息
  paymentConfig?: PaymentConfig;  // 支付限额
  policy?: PolicyState;           // 支付策略
  apiKey?: ApiKeyState;           // API Key
}
```

**加密方式**: AES-256-GCM，密钥来自环境变量 `STABLEPAY_PLUGIN_MASTER_KEY`

---

## 签名流程详解

### 1. DID 认证签名 (Gateway Auth)

用于 `/api/v1/balance`、`/api/v1/sales` 等需要 DID 认证的接口。

**签名数据**:
```
canonical = method + "|" + path + "|" + rawQuery + "|" + timestamp + "|" + nonce
```

**请求头**:
```
X-Signature: {base58_signature}
X-Timestamp: {timestamp}
X-Nonce: {nonce}
```

**代码位置**: `gateway_auth.ts#buildGatewayDidAuthHeaders()`

### 2. 支付业务签名

用于 `POST /api/v1/pay`。

**签名数据**:
```
sign_data = agent_did + "|" + skill_did + "|" + amount_minor + "|" + currency + "|" + timestamp + "|" + nonce
```

### 3. 交易签名 (OWS)

**流程**:
1. 构建 SPL 转账交易（部分签名）
2. OWS 签名交易消息字节
3. 生成业务签名 `sha256(signed_tx_base64)`
4. 提交到 Gateway

**代码位置**: `pay_settlement.ts#settlePaymentViaGateway()`

---

## 配置示例

### 最小配置

```json
{
  "backendBaseUrl": "https://ai.wenfu.cn",
  "localStatePath": "~/.config/openclaw/stablepay/stablepay-state.encrypted"
}
```

### 完整配置

```json
{
  "backendBaseUrl": "https://ai.wenfu.cn",
  "feePayerSolanaAddress": "H1vL...",
  "solanaRpcUrl": "https://api.devnet.solana.com",
  "splTokenMintAddress": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  "requestTimeoutMs": 90000,
  "localStatePath": "~/.config/openclaw/stablepay/stablepay-state.encrypted",
  "localStateKeyEnv": "STABLEPAY_PLUGIN_MASTER_KEY",
  "owsRuntime": "auto",
  "owsVaultPath": "~/.ows/vault",
  "owsPassphraseEnv": "OWS_PASSPHRASE",
  "owsRestBaseUrl": "http://localhost:3000",
  "owsRestSignPath": "/v1/sign/message",
  "pluginDebug": false
}
```

---

*文档版本：v1.0*
*最后更新：2026-04-19*
