# StablePay Mock OpenClaw Plugin

这是一个最小可跑的 OpenClaw 原生插件试做包，目标是把你前面做的 StablePay X 验证 mock 服务接进 OpenClaw。

它提供 6 个工具：

1. `stablepay_create_mock_wallet`
2. `stablepay_generate_verify_link`
3. `stablepay_seed_mock_tweet`
4. `stablepay_verify_x_mock`
5. `stablepay_query_balance`
6. `stablepay_get_verify_status`

---

## 1. 适用场景

配合你前面那套 Hertz mock 服务使用：

- 创建测试 DID / 钱包
- 生成 `verify?did=...` 链接
- 预埋一条 mock tweet
- 调用 `POST /verify-twitter`
- 查询 verify 状态
- 查询奖励余额

---

## 2. 目录结构

```text
stablepay-openclaw-plugin/
├── openclaw.plugin.json
├── package.json
├── tsconfig.json
├── README.md
├── examples/
│   └── plugins.entries.sample.json
└── src/
    ├── index.ts
    ├── client.ts
    ├── config.ts
    ├── types.ts
    └── utils.ts
```

---

## 3. 安装方式

### 方式 A：本地目录 link 安装

```bash
openclaw plugins install -l ./stablepay-openclaw-plugin
```

### 方式 B：安装 zip 包

```bash
openclaw plugins install ./stablepay-openclaw-plugin.zip
```

安装后执行：

```bash
openclaw plugins list
openclaw plugins info stablepay-mock-plugin
openclaw plugins enable stablepay-mock-plugin
openclaw plugins doctor
```

---

## 4. 插件配置

在 OpenClaw 配置里加入：

```json
{
  "plugins": {
    "entries": {
      "stablepay-mock-plugin": {
        "enabled": true,
        "config": {
          "backendBaseUrl": "http://127.0.0.1:8080",
          "verifyPageBaseUrl": "http://127.0.0.1:3000/verify",
          "requestTimeoutMs": 8000,
          "rewardAmount": 1
        }
      }
    }
  },
  "tools": {
    "allow": [
      "stablepay_create_mock_wallet",
      "stablepay_generate_verify_link",
      "stablepay_verify_x_mock",
      "stablepay_query_balance",
      "stablepay_get_verify_status",
      "stablepay_seed_mock_tweet"
    ]
  }
}
```

你也可以直接参考 `examples/plugins.entries.sample.json`。

---

## 5. 推荐联调顺序

### 第一步：先启动你的 Hertz mock 服务

默认假设服务跑在：

```text
http://127.0.0.1:8080
```

### 第二步：让 OpenClaw 调工具

#### 创建钱包

```text
帮我创建一个 StablePay mock 钱包
```

#### 生成验证链接

```text
帮我给 DID did:solana:xxxx 生成 verify 链接
```

#### 预埋 tweet

```text
用 stablepay_seed_mock_tweet 写入一条 tweet，
url 是 https://x.com/alice/status/123456789，
内容是 I'm verifying my StablePay DID: did:solana:xxxx
```

#### 调用验证

```text
调用 stablepay_verify_x_mock，did 是 did:solana:xxxx，tweet_url 是 https://x.com/alice/status/123456789
```

#### 查询余额

```text
查询 DID did:solana:xxxx 的 StablePay 余额
```

---

## 6. 当前实现说明

这版插件是“试做开发包”，重点是先把 OpenClaw 工具入口接起来：

- 插件内直接调用你本地 Hertz 服务
- 使用 `api.registerTool(...)` 暴露工具
- 用 `openclaw.plugin.json` 暴露配置 Schema
- `backendBaseUrl` 从 `plugins.entries.stablepay-mock-plugin.config` 读取

这版还没有做：

- 真正的 X API 抓取
- OAuth
- 真链奖励发放
- 购买 / 402 支付流程
- 网页内嵌交互式按钮

---

## 7. 下一步建议

你接下来最顺的迭代顺序是：

1. 把 `stablepay_seed_mock_tweet` 改成调用真实 tweet 抓取逻辑
2. 把 `stablepay_create_mock_wallet` 改成调用真实 DID Service
3. 再补一个 `stablepay_open_verify_page` 或 HTTP route
4. 最后把支付 / 402 流程工具也接进来

---

## 8. 本地开发

```bash
npm install
npm run check
```

如果你的 OpenClaw 宿主已经提供 `openclaw` 运行时，主要依赖是：

- `openclaw`
- `@sinclair/typebox`

---

## 9. 常见问题

### Q1. 为什么 verifyPageBaseUrl 和 backendBaseUrl 分开？

因为验证页面可能跑在 React dev server，例如 `http://127.0.0.1:3000/verify`，但接口服务跑在 `http://127.0.0.1:8080`。

### Q2. 为什么还保留 `stablepay_seed_mock_tweet`？

因为你现在第一阶段是 mock 验证，它可以帮你快速演示从 tweet 到 verify 的闭环。

### Q3. 为什么 rewardAmount 没真的参与链上逻辑？

因为这版是插件入口试做，奖励金额只是 UI 提示，真正的奖励还是由你的后端 mock 服务决定。
