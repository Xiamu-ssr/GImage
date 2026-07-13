---
type: DataStore
title: GImage 本地数据模型
description: 单实例部署下账户、额度、会话、资产、运行时目录和知识契约的本地文件布局。
tags: [data, json, assets, quota, okf, dsl]
timestamp: 2026-07-13
---

# 本地数据模型

所有可变数据位于被 Git 忽略的 `data/` 目录：

```text
data/
├── accounts.json          # 用户名、bcrypt 密码哈希、角色、每日额度
├── usage/YYYY-MM-DD.json  # 每日实际消费与预扣 reservation
├── sessions/              # session-file-store 持久化会话
├── images/<username>/     # 输出媒体、输入参考图及同名元数据 JSON
├── config/                # 运行时 models.json、providers.json 与 .history/
└── knowledge/
    ├── okf/               # 可编辑的 Markdown + YAML frontmatter
    ├── contracts/         # 唯一事实来源：gimage/1 YAML DSL
    └── .history/          # OKF 与 DSL 保存前的本地版本
```

## 额度账本

每日用户记录含 `spent`、`reserved`、`count`、`history` 和 `reservations`。

1. 生成请求在调用上游前原子写入 `reservations` 并增加 `reserved`。
2. 同步生成成功或异步任务完成时，将 reservation 移入 `spent/history`。
3. 上游失败时删除 reservation 并释放 `reserved`。

这避免了并发请求分别读取“剩余额度”而造成超额。旧视频任务没有 reservation 时，仍沿用兼容的完成后结算逻辑。

## 备份与恢复

停止服务或确保无写入后备份整个 `data/`。恢复时以目录整体替换；不要分别恢复 `usage` 和 `images`，以避免额度记录和资产元数据不一致。

相关内容：[产品成本规则](product.md)、[单一 DSL](dsl.md)、[单实例约束](architecture.md)、[运维流程](operations.md)。
