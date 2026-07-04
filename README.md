# GImage — 自托管多账户 AI 创作站

基于 [ZenMux](https://zenmux.ai)(图片/视频)+ [MiniMax](https://api.minimax.io)(音乐)多模型 API 的网页创作工具,UI 参考「即梦」做了精简。管理员可创建账户、设置每日额度,把账户分给朋友使用。**不依赖数据库**,所有数据以本地 JSON 文件 + 媒体文件存储。

## 功能

- 🔐 管理员 / 普通用户两种角色,session 登录(重启不掉线)
- 🎨 **图片生成**:4 个模型可选(GPT-Image-2 默认,支持多图参考;Nano Banana 2 / Nano Banana Pro;Qwen-Image-2.0-Pro),支持以图改图、多轮编辑
- 🎬 **视频生成**:Seedance 2.0(豆包),文生视频/图生视频,支持多参考图,异步任务(提交后轮询进度)
- 🎵 **音乐生成**:MiniMax Music 2.6,歌词 + 风格描述生成完整歌曲,支持纯音乐模式,直连 MiniMax(不经 ZenMux)
- 📎 加参考图时可选**本地上传或从资产库选择**——比即梦多一种更方便的方式
- 📊 每账户每日额度(美元计,默认 $1.5/天,管理后台可逐个自定义),三种模态共用同一额度池,按天自动重置
- 🖼️ 统一资产库:图片/视频/音乐混排,按日期分组,支持按模态筛选、搜索、批量下载/删除
- 👤 管理后台:增删账户、改密码、改额度、按模态查看今日用量与花费、审阅所有账户的会话与生成内容
- 💰 服务器状态面板:显示 ZenMux 订阅档位、Flow 配额(5小时/7天)剩余、PAYG 余额——一眼看出「是不是订阅没额度了」
- 💾 纯本地存储:`data/` 目录下 JSON + 媒体文件,迁移/备份只需拷贝该目录

## 快速开始(推荐:一键脚本)

```bash
bash setup.sh
```

脚本会引导你:粘贴 ZenMux + MiniMax 密钥 → 自动生成管理员账号和随机强密码 → 写好 `.env` → 装依赖 → 结尾**显示一次管理员账密**(请保存),并可直接启动。

> 需要的密钥:
> - **ZenMux 生图密钥**(`sk-ai-v1-...` 或 `sk-ss-v1-...`,[控制台获取](https://zenmux.ai)):调用图片/视频模型,必填。
> - **ZenMux 管理密钥**(`sk-mg-v1-...`):只读,用于在管理页显示服务器余额/配额,可留空跳过。
> - **MiniMax 密钥**([开放平台获取](https://api.minimax.io)):音乐生成用,可留空跳过(跳过则音乐功能不可用,图片/视频不受影响)。

## 手动配置(可选)

```bash
npm install
cp .env.example .env   # 编辑填入密钥、管理员账号、端口
npm start
```

## 使用流程

1. **管理员登录** → 右上角「管理」进入后台 → 「新建账户」给朋友建号(设用户名、密码、每日额度)。
2. 把账号密码发给朋友,他们登录后即可在工作台创作。
3. **工作台**:顶部切换「图片 / 视频 / 音乐」→ 选模型 → 输入提示词 → 生成。想基于某张图继续改,上传参考图或从资产库选一张。
4. 视频生成是异步任务,提交后会显示进度,完成后自动展示;图片和音乐是同步返回。
5. 每次生成按模型单价从当日额度扣费,额度用完当天无法再生成,**次日 0 点自动恢复**(按日期分文件,无需定时任务)。

## 模型与成本(参考)

| 模态 | 模型 | 参考图/输入 | 每次约成本 | 说明 |
|---|---|---|---|---|
| 图片 | GPT-Image-2(默认) | 最多 16 张参考图 | ~$0.15 | 支持多图合成,质量与灵活性最均衡 |
| 图片 | Nano Banana 2 (Gemini 3.1 Flash) | 单图参考 | ~$0.07 | 快速高效 |
| 图片 | Nano Banana Pro (Gemini 3 Pro) | 单图参考 | ~$0.13 | 质量最高 |
| 图片 | Qwen-Image-2.0-Pro | 无参考图 | ~$0.07 | 通义出品,纯文生图 |
| 视频 | Seedance 2.0 (Doubao) | 最多 9 张参考图 | ~$0.5(预估) | 文生视频/图生视频,异步任务 |
| 音乐 | MiniMax Music 2.6 | 歌词 + 风格描述 | ~$0.1(预估,直连 MiniMax) | 支持纯音乐(无人声)模式 |

> 实际单价以 `config/models.json` 中 `costUSD` 为准(按固定单价扣费,非按实际 token/时长计费)。视频/音乐单价为估算,如与真实成本偏差较大可在此文件调整。

## 目录结构

```
server.js          入口:Express + session + 路由
setup.sh           一键安装向导
src/
  store.js         JSON 读写(串行写队列,防并发损坏)
  httpUtil.js       通用 HTTP 请求封装(重试/超时)
  accounts.js      账户 CRUD + bcrypt
  quota.js         按天美元额度检查/扣减(图片/视频/音乐共用)
  providers.js     ZenMux 生成适配层(gemini / openai-images 协议 + 视频任务提交/轮询)
  minimax.js       MiniMax 音乐生成(直连,同步)
  assets.js        资产元数据读写、装饰、待完成视频任务的额度预留
  platform.js      ZenMux 平台 API(查服务器余额/订阅配额,60s 缓存)
  auth.js          登录/管理员中间件
config/models.json 模型清单(图片×4、视频×1、音乐×1,含参数 schema 与单价)
public/            前端(login / app / gallery / admin,原生 ES Module,无构建步骤)
  shared/          前端公共模块(dom / api / format / lightbox / user)
data/              运行时数据(账户、用量、媒体文件、会话)— 不入库
```

## 部署到服务器

```bash
# 用 pm2 守护进程(推荐)
npm i -g pm2
pm2 start server.js --name gimage
pm2 save && pm2 startup
```

建议在前面挂 **Nginx 反向代理 + HTTPS**(Let's Encrypt)。示例:

```nginx
server {
    listen 443 ssl;
    server_name your.domain.com;
    # ssl_certificate / ssl_certificate_key ...
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        client_max_body_size 20m;   # 允许上传参考图
    }
}
```

**备份**:定期拷贝 `data/` 目录即可。例如每日 cron:

```bash
0 3 * * * tar czf /backup/gimage-$(date +\%F).tgz -C /path/to/GImage data
```

## 注意

- 生成调用 ZenMux / MiniMax 真实接口,需账户有余额/订阅额度/API Key 额度。
- 图片/音乐 API 本身无状态(单轮);多轮编辑由本应用把历史图片随请求一起回传实现。视频任务提交后由前端轮询状态,不依赖服务器后台任务。
- 若生成报错,错误信息会原样透传到前端,便于排查(常见:key 无效、余额不足、模型不可用)。
- 视频生成中的任务会先占用当日额度(避免同时提交多个任务超支),完成后按实际结果确认扣费。
