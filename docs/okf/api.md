---
type: API
title: GImage HTTP API
description: 浏览器前端使用的同源 Session API。
tags: [api, rest, auth, generation]
timestamp: 2026-07-13
---

# HTTP API

所有接口以 `/api` 开头，除登录外均要求有效 Session。写操作在生产环境要求同源 `Origin`。

| 区域 | 代表接口 | 说明 |
| --- | --- | --- |
| 会话 | `POST /login`、`POST /logout`、`GET /me` | 登录、登出、当前额度 |
| 创作 | `GET /models`、`POST /generate`、`GET /jobs/:id` | 模型目录、发起任务、轮询视频 |
| 音乐 | `POST /music-cover/preprocess` | MiniMax 高级翻唱：提取特征和可编辑歌词 |
| 资产 | `GET /assets`、`GET /history`、`GET/DELETE /asset/:id` | 资产库、会话历史、媒体服务 |
| 管理 | `/admin/accounts`、`/admin/usage`、`/admin/records/:username` | 管理员专用账户、用量、内容审阅 |
| 知识 | `GET/PUT /admin/knowledge/:kind/:id`、`POST /admin/knowledge/validate` | 管理员查询、校验并保存 OKF、DSL 或运行时模型/供应商目录 |

## 生成契约

`POST /generate` 使用 `multipart/form-data`：`model`、`prompt`、`params`、可选 `sessionId`、`refAssetIds`、最多 16 个 `refImages` 与一份 `refAudio`。服务端以模型配置白名单验证 `params`；参考图只接受 PNG/JPEG/WebP，单文件最大 15 MB；翻唱参考音频最大 50 MB。

图片与音乐同步返回资产地址；视频返回 `pollUrl`。所有返回给浏览器的资产 URL 都由 API 权限检查后提供。

知识保存使用 `expectedUpdatedAt` 进行乐观并发检查。OKF/DSL 保存前先通过前端和服务端校验，成功后会写入本地历史；模型和供应商目录只接受 JSON，供应商配置不得包含真实密钥。

相关内容：[产品行为](product.md)、[数据账本](data-model.md)、[单一 DSL](dsl.md)、[安全与部署](operations.md)。
