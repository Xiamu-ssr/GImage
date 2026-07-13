---
type: KnowledgeContractGuide
title: GImage 单一 DSL 与知识工作台
description: 一份 YAML 契约如何派生业务流程、关系图、规则、模型目录与 OKF 叙述文档。
tags: [okf, dsl, workflow, governance]
timestamp: 2026-07-13
---

# 单一 DSL 与知识工作台

GImage 不为流程图、规则、模型或接口分别维护多种 DSL。运行时唯一的可执行知识事实是 `data/knowledge/contracts/*.yaml` 中的 `gimage/1` 契约。OKF Markdown 只负责背景、决策和链接，不重复契约里的状态迁移或关系。

## DSL 最小原语

- `entities`：有稳定 ID 的业务对象，可声明状态集合。
- `rules`：约束或治理原则。
- `externals.operations`：外部能力及其操作。
- `paragraphs`：业务段落，包含 `steps`、`branches` 和可选 `next`。
- `relations`：任意节点之间的显式关系；允许 N:N 和循环。

步骤仅使用 `create`、`write`、`change`、`call`、`guard`、`forbid`、`retry`、`next`、`note`。`then`、`else` 与嵌套 `steps` 可以表达分支内部流程。`intent`/`note` 保留自然语言解释；实体、状态、外部操作、关系和跳转目标必须能被校验。

## 投影而不是副本

知识工作台即时从同一 YAML 生成以下视图：

- **流程图**：段落 `next`、分支跳转、嵌套步骤跳转和显式关系。
- **逻辑与状态**：规则、状态变迁、外部调用和诊断。
- **模型查询**：`data/config/models.json` 与 `providers.json` 的运行时目录；与 DSL 中的 `model_catalog` 建立关联。

图不写回 Markdown，也不保存 Mermaid 或第二份流程定义。保存前会校验 ID、实体/状态、段落跳转、外部操作和关系引用；循环不视为错误，也不会以“不可达”产生噪音告警。

## 本地编辑与历史

管理员可从 `/knowledge` 阅读、搜索、编辑和保存 OKF、DSL 与模型目录。DSL/OKF 的每次成功保存会将上一版本存至 `data/knowledge/.history/`；模型和供应商目录的上一版本保存在 `data/config/.history/`。运行时目录保存在 `data/config/`；仓库内 `config/` 仅是部署种子，密钥继续从环境变量读取。
