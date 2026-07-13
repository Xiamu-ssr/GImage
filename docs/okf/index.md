---
type: KnowledgeBundle
title: GImage 知识包
description: GImage 的产品、架构、数据、接口与运维事实来源。
tags: [gimage, ai-studio, okf, internal]
timestamp: 2026-07-13
---

# GImage 知识包

这是随代码维护的内部知识包。每个概念独立成文、带 YAML 元数据并以链接显式关联，供人和 AI 代理阅读。

- [产品与边界](product.md)
- [系统架构](architecture.md)
- [本地数据模型](data-model.md)
- [HTTP API](api.md)
- [模型与供应商](providers.md)
- [单一 DSL 与知识工作台](dsl.md)
- [运行与故障处理](operations.md)

## 格式约定

采用 Google Cloud 发布的 [Open Knowledge Format v0.1](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)：Markdown 文件、YAML frontmatter、每个概念至少包含 `type`，并以链接形成可遍历的知识图。OKF 是面向代理上下文的开放格式，不是运行时或搜索排名机制。

## 维护规则

首次启动时，本目录会复制到 `data/knowledge/okf/`；之后由知识工作台管理的运行时版本是可编辑事实来源。修改产品行为、数据格式、外部 API 或部署方式时，必须同步更新对应文档和 `timestamp`。不将密码、密钥、用户名或用户生成内容写入本目录。
