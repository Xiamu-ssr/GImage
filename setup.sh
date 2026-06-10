#!/usr/bin/env bash
# GImage 一键安装脚本
# 用法: bash setup.sh
# 作用: 引导填入两个 ZenMux key,自动生成管理员账号密码与 .env,安装依赖。
set -e

cd "$(dirname "$0")"

BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; CYAN=$'\033[36m'; RED=$'\033[31m'; RESET=$'\033[0m'

echo "${BOLD}${CYAN}=== GImage 安装向导 ===${RESET}"
echo

# ---------- 0. 检查 node ----------
if ! command -v node >/dev/null 2>&1; then
  echo "${RED}未检测到 Node.js,请先安装 Node 18+(推荐 20/22)。${RESET}"
  exit 1
fi
echo "Node 版本: $(node -v)"
echo

# ---------- 1. 已存在 .env 的处理 ----------
if [ -f .env ]; then
  echo "${YELLOW}检测到已存在 .env 文件。${RESET}"
  printf "覆盖重新配置? 这会重置管理员账号密码 [y/N]: "
  read -r ans
  case "$ans" in
    y|Y) ;;
    *) echo "已取消。如只想启动,运行: ${BOLD}npm start${RESET}"; exit 0;;
  esac
fi

# ---------- 2. 收集 key ----------
echo "${BOLD}请粘贴你的 ZenMux 密钥(在 https://zenmux.ai 控制台获取)${RESET}"
echo
printf "1) ${BOLD}生图密钥${RESET}(调用模型用,sk-ai-v1-... 或 sk-ss-v1-...): "
read -r API_KEY
while [ -z "$API_KEY" ]; do
  printf "${RED}不能为空,请重新输入生图密钥: ${RESET}"
  read -r API_KEY
done

echo
printf "2) ${BOLD}管理密钥${RESET}(查余额用,sk-mg-v1-...,${DIM}可留空跳过${RESET}): "
read -r MGMT_KEY

echo
# ---------- 3. 管理员账号 ----------
printf "3) 管理员用户名 [${BOLD}admin${RESET}]: "
read -r ADMIN_USER
ADMIN_USER="${ADMIN_USER:-admin}"

# 自动生成强随机密码与 session secret(用 node,跨平台稳定)
ADMIN_PASS="$(node -e "console.log(require('crypto').randomBytes(9).toString('base64').replace(/[+/=]/g,'').slice(0,12))")"
SESSION_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"

echo
printf "4) 监听端口 [${BOLD}3000${RESET}]: "
read -r PORT
PORT="${PORT:-3000}"

# ---------- 4. 写 .env ----------
cat > .env <<EOF
# 由 setup.sh 于 $(date '+%Y-%m-%d %H:%M:%S') 生成
ZENMUX_API_KEY=$API_KEY
ZENMUX_MANAGEMENT_KEY=$MGMT_KEY
ZENMUX_OPENAI_BASE=https://zenmux.ai/api/v1
ZENMUX_GEMINI_BASE=https://zenmux.ai/api/v1

PORT=$PORT
SESSION_SECRET=$SESSION_SECRET

ADMIN_USER=$ADMIN_USER
ADMIN_PASS=$ADMIN_PASS
EOF
chmod 600 .env
echo "${GREEN}✓ 已生成 .env${RESET}"

# ---------- 5. 安装依赖 ----------
echo
echo "正在安装依赖(npm install)…"
npm install --silent
echo "${GREEN}✓ 依赖安装完成${RESET}"

# ---------- 6. 显示账密(仅此一次) ----------
echo
echo "${BOLD}${GREEN}════════════════════════════════════════════${RESET}"
echo "${BOLD}  安装完成!以下管理员账号仅显示这一次,请保存:${RESET}"
echo "${BOLD}${GREEN}════════════════════════════════════════════${RESET}"
echo "    用户名:  ${BOLD}${CYAN}$ADMIN_USER${RESET}"
echo "    密码:    ${BOLD}${CYAN}$ADMIN_PASS${RESET}"
echo "    地址:    ${BOLD}http://localhost:$PORT${RESET}"
echo "${BOLD}${GREEN}════════════════════════════════════════════${RESET}"
echo "${DIM}(账号密码已写入 .env;如需修改可重跑 setup.sh 或登录后台改密)${RESET}"
echo
printf "现在就启动服务吗? [Y/n]: "
read -r run
case "$run" in
  n|N) echo "稍后用 ${BOLD}npm start${RESET} 启动。";;
  *) echo "启动中…(Ctrl+C 可停止)"; exec npm start;;
esac
