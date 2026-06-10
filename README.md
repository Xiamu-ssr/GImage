# GImage — 自托管多账户网页生图站

基于 [ZenMux](https://zenmux.ai) 多模型 API 的网页生图工具。管理员可创建账户、设置每日配额,把账户分给朋友使用。**不依赖数据库**,所有数据以本地 JSON 文件 + 图片文件存储。

## 功能

- 🔐 管理员 / 普通用户两种角色,session 登录(重启不掉线)
- 🎨 多模型可选:Nano Banana Pro / Gemini 2.5 Flash Image / GPT-Image-2
- 🖼️ 支持「以图改图 / 多轮编辑」(上传参考图,或以上一张结果继续修改)
- 📊 每账户每日配额(默认 10,管理后台可逐个自定义),按天自动重置
- 👤 管理后台:增删账户、改密码、改配额、查看今日用量与成本估算
- 💰 服务器状态面板:显示 ZenMux 订阅档位、Flow 配额(5小时/7天)剩余、PAYG 余额——一眼看出「是不是订阅没额度了」
- 💾 纯本地存储:`data/` 目录下 JSON + PNG,迁移/备份只需拷贝该目录

## 快速开始(推荐:一键脚本)

```bash
bash setup.sh
```

脚本会引导你:粘贴两个 ZenMux 密钥 → 自动生成管理员账号和随机强密码 → 写好 `.env` → 装依赖 → 结尾**显示一次管理员账密**(请保存),并可直接启动。

> 需要两个密钥(都在 [ZenMux 控制台](https://zenmux.ai) 获取):
> - **生图密钥**(`sk-ai-v1-...` 或 `sk-ss-v1-...`):调用模型生图,必填。
> - **管理密钥**(`sk-mg-v1-...`):只读,用于在管理页显示服务器余额/配额,可留空跳过。

## 手动配置(可选)

```bash
npm install
cp .env.example .env   # 编辑填入两个 key、管理员账号、端口
npm start
```

## 使用流程

1. **管理员登录** → 右上角「管理」进入后台 → 「新建账户」给朋友建号(设用户名、密码、每日配额)。
2. 把账号密码发给朋友,他们登录后即可在工作台生图。
3. **工作台**:选模型 → 输入提示词 → 生成。想基于某张图继续改,点「以这张继续修改」或上传参考图。
4. 每生成一张扣一次配额,用完当天无法再生成,**次日 0 点自动恢复**(按日期分文件,无需定时任务)。

## 模型与成本(参考)

| 模型 | 每张约成本 | 说明 |
|---|---|---|
| Gemini 2.5 Flash Image | ~$0.02–0.04 | 性价比首选,日常推荐 |
| Nano Banana Pro (Gemini 3 Pro) | ~$0.13 | 质量最高 |
| GPT-Image-2 | ~$0.01–0.17 | 随分辨率/质量浮动 |

> 6 账户 × 10 张/天 = 60 张/天满载,约 $2–8/天。实际很难天天打满。
> 模型清单与单价可在 `config/models.json` 调整。

## 目录结构

```
server.js          入口:Express + session + 路由
setup.sh           一键安装向导
src/
  store.js         JSON 读写(串行写队列,防并发损坏)
  accounts.js      账户 CRUD + bcrypt
  quota.js         按天配额检查/扣减
  providers.js     生图适配层(gemini / openai-images 两种协议)
  platform.js      ZenMux 平台 API(查服务器余额/订阅配额,60s 缓存)
  auth.js          登录/管理员中间件
config/models.json 可选模型清单
public/            前端(login / app / admin)
data/              运行时数据(账户、用量、图片、会话)— 不入库
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

- 生图调用 ZenMux 真实接口,需账户有余额/订阅额度。
- API 本身无状态(单轮);多轮编辑由本应用把历史图片随请求一起回传实现。
- 若生图报错,错误信息会原样透传到前端,便于排查(常见:key 无效、余额不足、模型不可用)。
