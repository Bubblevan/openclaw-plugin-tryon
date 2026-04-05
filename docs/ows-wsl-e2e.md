# WSL：OWS CLI 与 StablePay 联调（RegisterDID → Pay）

本流程对应「客户端自持私钥」：私钥仅在 OWS Vault（`~/.ows/`），did-service 只存公钥。

## 前置

1. Docker 栈已启动（`stablepayai-idl/docker-compose.infra.yml` + `docker-compose.services.yml`），Gateway 可达（例如 `http://127.0.0.1:28080`）。
2. WSL 中已安装 [OWS CLI](https://docs.openwallet.sh/)（`ows --version` 成功）。
3. OpenClaw 插件配置 `backendBaseUrl` 指向 Gateway；`STABLEPAY_PLUGIN_MASTER_KEY` 已设置。

## 1. 创建 OWS 钱包并取 Solana 公钥

```bash
ows wallet create --name stablepay-agent
ows wallet list
```

记下 **Solana** 一行的地址（Base58）以及钱包 **名称** `stablepay-agent`（或 UUID，以 `ows sign message` 接受的 `--wallet` 为准）。

## 2. 设置签名凭据

使用钱包口令或 Agent API Key（见 `ows key create`）：

```bash
export OWS_PASSPHRASE="your-passphrase-or-ows_key_..."
```

## 3. OpenClaw：绑定钱包并注册 DID

调用 `stablepay_create_local_wallet`，参数示例：

- `runtime`: `ows-cli`（或 `wsl-ows`，等价）
- `wallet_name`: `stablepay-agent`（与 OWS 中名称一致）
- `public_key`: 上一步 Solana 地址（Base58）

然后调用 `stablepay_register_local_did` 将公钥登记到 `POST /api/v1/did/register`。

## 4. 支付签名

`stablepay_execute_paid_skill_demo` 等工具内部会构造 Gateway canonical 并调用 `stablepay_sign_message` 等价逻辑；在 **ows-cli** 驱动下会执行：

`ows sign message --wallet <name> --chain solana --message '<canonical>' --json`

签名由插件从 JSON 的 `signature`（hex）转为 Base58 后写入 `X-StablePay-Signature`。

## 5. 可选：ows-rest

若你自有或上游提供符合 `SignMessageRequest` 的 HTTP 服务，在插件 config 中设置 `owsRestBaseUrl`、`owsRestSignPath`（默认 `/v1/sign/message`）、`owsRestWalletId`，并导出 `STABLEPAY_OWS_REST_API_KEY`。使用 `runtime: "ows-rest"` 与 `public_key` / `ows_wallet_id` 绑定钱包。

## 6. 关闭服务端托管创建（生产建议）

在 api-gateway `configs/config.yaml` 设置：

```yaml
features:
  allow_did_create: false
```

或使用环境变量 `STABLEPAY_FEATURES_ALLOW_DID_CREATE=false`。此后仅允许 `POST /api/v1/did/register`。

详见仓库根目录 [api-gateway/docs/did-flow.md](../../api-gateway/docs/did-flow.md) 与 [did-service/DID_MODEL.md](../../did-service/DID_MODEL.md)。
