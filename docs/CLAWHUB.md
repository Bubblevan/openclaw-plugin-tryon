# 发布到 ClawHub

本仓库当前口径：

- package slug（安装名）：`stablepay-openclaw-plugin`（见 `package.json.name`）
- runtime id（manifest）：`stablepayai`（见 `openclaw.plugin.json.id`）

> 注意：已发布 package line 下，runtime id 需保持稳定。

## 准备

1. 在本目录执行构建：`npm install && npm run build`（`prepack` 也会触发构建）。
2. 安装 CLI：`pnpm add -g clawhub`（或官方文档中的其他方式）。

## Dry run

```bash
clawhub package publish /path/to/stablepay-openclaw-plugin --dry-run
```

若已推送到 GitHub：

```bash
clawhub package publish https://github.com/YOUR_ORG/stablepay-openclaw-plugin --dry-run
```

## 正式发布

```bash
clawhub package publish https://github.com/YOUR_ORG/stablepay-openclaw-plugin
# 或指定版本/tag
clawhub package publish YOUR_ORG/stablepay-openclaw-plugin@v0.3.0
```

将 `YOUR_ORG` 换成你的组织或用户名。

## WSL / 团队成员安装

```bash
openclaw plugins install clawhub:stablepay-openclaw-plugin
openclaw gateway restart
```

更新：

```bash
openclaw plugins update --all
```

## 元数据

`package.json` 中的 `openclaw.extensions`、`openclaw.compat`、`openclaw.build` 需与当前 OpenClaw / plugin-sdk 版本对齐；升级网关后请同步修改 `compat` 与 `build` 字段。
