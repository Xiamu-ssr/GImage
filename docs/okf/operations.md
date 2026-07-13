---
type: Runbook
title: GImage 运行手册
description: 单实例生产部署、健康检查、备份和常见故障处理。
tags: [operations, deployment, backup, incident]
timestamp: 2026-07-13
---

# 运行手册

## 部署前检查

1. 配置 `.env`，特别是随机 32 位以上的 `SESSION_SECRET`、管理员初始账号和上游密钥。
2. 执行 `npm ci && npm run build`；构建必须通过类型检查。
3. 以 `NODE_ENV=production npm start` 启动，或构建 Docker 镜像并持久挂载 `/app/data`。
4. 检查 `GET /healthz` 返回 `{ "ok": true }`。

## 备份

每天备份 `data/` 整个目录，并定期做恢复演练。密钥在 `.env`，应由独立的秘密管理或安全备份流程保护，不能提交到 Git。

## 故障处理

- **登录被拒绝**：确认账户存在；连续失败会触发 15 分钟登录限流。
- **生成失败**：检查上游密钥、余额与模型可用性；失败会释放新的预扣额度。
- **视频长期排队**：从资产库或会话页继续轮询；若上游确认失败，任务状态会更新为 `failed`。
- **磁盘增长过快**：从资产库删除不需要的媒体，并确认备份已经完成。

## 扩容决策

仅在单实例运行。需要多副本、共享存储或高并发结算时，先将 [本地数据模型](data-model.md) 迁移到事务型数据库和对象存储，再扩容 API 实例。
