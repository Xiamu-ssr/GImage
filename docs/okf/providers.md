---
type: IntegrationCatalog
title: GImage 模型与供应商
description: 当前核心模型、MiniMax 音乐工作流和可配置供应商注册表。
tags: [providers, models, zenmux, minimax, media]
timestamp: 2026-07-13
---

# 模型与供应商

运行时模型目录在 `data/config/models.json`，供应商端点和环境变量映射在 `data/config/providers.json`；首次启动时分别从仓库 [`config/models.json`](../../config/models.json) 与 [`config/providers.json`](../../config/providers.json) 复制。模型引用供应商名称而不直接把 URL 或密钥写入业务代码。

## 当前产品目录

| 模态 | 模型 | 供应商 | 用途 |
| --- | --- | --- | --- |
| 图片 | `google/gemini-3.1-flash-lite-image` | ZenMux | 会话式图片创作与单图参考 |
| 图片 | `openai/gpt-image-2` | ZenMux | 多图编辑，最多 16 张参考图 |
| 视频 | `bytedance/doubao-seedance-2.0` | ZenMux | 文生/图生视频 |
| 音乐 | `music-2.6` | MiniMax | 写词、自动写词或纯音乐 |
| 音乐 | `music-cover` | MiniMax | 快速翻唱与高级两步翻唱 |

## MiniMax 音乐工作流

1. **文本音乐**：`music-2.6` 接收风格和歌词；也可开启 `lyrics_optimizer` 自动写词，或选择纯音乐。
2. **快速翻唱**：`music-cover` 接收参考音频与目标演唱描述，服务端以 `audio_base64` 调用；歌词可留空，由 MiniMax 自动识别。
3. **歌词编辑翻唱**：先调用 `/api/music-cover/preprocess`，获得 24 小时有效的 `cover_feature_id`、识别歌词和段落时间线。用户校正歌词后，以 `cover_feature_id`、歌词和目标演唱描述调用同一个 `music-cover` 模型。

## 扩展供应商

已内置但默认关闭的 OpenAI Images 与 Gemini 兼容供应商。启用方式：在 `providers.json` 把对应 `enabled` 设为 `true`，配置环境变量，并在 `models.json` 添加使用现有协议（`openai-images` 或 `gemini`）的模型条目。新端点不应绕过服务端密钥管理、超时、上传限制或额度账本。

`gemini-omni-flash-preview` 是 Google 的预览视频生成/编辑模型，接受文本、图像和短视频并输出 3–10 秒 720p 视频。当前产品按“视频仅保留 Seedance”原则不在用户目录中启用；当 ZenMux 确认其 Vertex Generate Videos / Interactions 路由可用时，可作为 `enabled: false` 的实验模型接入，而不影响核心目录。

相关内容：[系统架构](architecture.md)、[API](api.md)、[成本与产品边界](product.md)。
