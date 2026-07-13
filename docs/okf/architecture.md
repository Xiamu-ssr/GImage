---
type: System
title: GImage 系统架构
description: React 单页前端、Express API、上游模型适配器和本地持久化的部署结构。
tags: [architecture, react, express, vite, security]
timestamp: 2026-07-13
---

# 系统架构

```text
Browser ── React + TypeScript SPA ──► Express API ──► ZenMux / MiniMax
                                           │
                                           └────────► data/ (JSON, sessions, media)
```

## 组件职责

- `frontend/`：Vite 构建的 React SPA；React Query 管理服务端状态，React Hook Form + Zod 处理登录表单。
- `server.js`：认证、授权、限流、上传、REST 路由和静态资源服务。
- `src/providerRegistry.js`、`src/providers.js`、`src/minimax.js`：隔离不同上游协议，包含请求超时与下载 URL 校验；运行时供应商目录在 `data/config/providers.json`（首次从 `config/` 种子复制）。
- `src/store.js`：同一 Node 进程内的原子 JSON/文本写入队列；知识与模型目录同样使用它。
- `dist/`：可缓存的生产前端构建产物；不提交到 Git。

## 安全边界

- 使用服务端 Session，生产 Cookie 为 `HttpOnly + Secure + SameSite=Strict`。
- Helmet、登录限流、生成限流、同源写请求校验和文件数量/大小/MIME 限制在 API 边缘生效。
- 不将上游原始错误、密钥或文件系统路径返回给浏览器。

## 约束

本地文件存储适用于**单实例**部署。`src/store.js` 的队列只在单个 Node 进程有效；若要多实例部署，应迁移到具备事务/锁能力的数据库与对象存储。

相关内容：[数据模型](data-model.md)、[API](api.md)、[模型与供应商](providers.md)、[运维](operations.md)。
