#!/usr/bin/env bash
# ==============================================================================
# DaMaoCode 一键启动脚本（macOS / Linux）
# 流程：清理缓存 -> 检查 dmcode-server -> 检测/构建最新 jar -> 启动后端 -> 启动前端
# 用法：bash scripts/start-dev.sh [--clean] [--rebuild] [--no-server] [--no-client]
#   --clean      深度清理（删除 node_modules/.vite、tsbuildinfo，并重新 npm install）
#   --rebuild    强制重新构建服务端 jar
#   --no-server  跳过后端启动（后端已在别处运行时使用）
#   --no-client  跳过前端启动（只启动后端）
# ==============================================================================
set -euo pipefail  #避免后续在错误环境下继续执行。
#${BASH_SOURCE[0]}：表示当前脚本文件自身的路径。
#dirname "${BASH_SOURCE[0]}：获取脚本所在目录
#CLIENT_DIR=其实就是项目目录
CLIENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
#SERVER_DIR=获取同目录的dmcode-server目录
SERVER_DIR="$(cd "$CLIENT_DIR/.." && pwd)/dmcode-server"
PORT=8091
LOG_FILE="${TMPDIR:-/tmp}/dmcode-server-dev.log"
PID_FILE="${TMPDIR:-/tmp}/dmcode-server-dev.pid"
#CLEAN=0:默认不进行深度清理
#REBUILD=0:默认不进行强制重新构建
#START_SERVER=1:默认启动后端
#START_CLIENT=1:默认启动前端
CLEAN=0; REBUILD=0; START_SERVER=1; START_CLIENT=1
#遍历参数
#$@ 表示传递给脚本的所有参数。
for arg in "$@"; do
  case "$arg" in
    --clean) CLEAN=1 ;;
    --rebuild) REBUILD=1 ;;
    --no-server) START_SERVER=0 ;;
    --no-client) START_CLIENT=0 ;;
    *) echo "未知参数: $arg" ;;
  esac
done
#定义颜色
#GREEN:绿色
#YELLOW:黄色
#RED:红色
#CYAN:青色
#NC:无颜色
GREEN='\033[32m'; YELLOW='\033[33m'; RED='\033[31m'; CYAN='\033[36m'; NC='\033[0m'
info()  { echo -e "${CYAN}[INFO]${NC} $1"; }
ok()    { echo -e "${GREEN}[ OK ]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
fail()  { echo -e "${RED}[FAIL]${NC} $1"; exit 1; }

echo "=============================================="
echo "  DaMaoCode 一键启动（dev 模式）"
echo "  客户端目录: $CLIENT_DIR"
echo "=============================================="

# ---------- 1. 缓存清理 ----------
info "清理前端缓存..."
rm -rf "$CLIENT_DIR/node_modules/.vite"
rm -f  "$CLIENT_DIR/tsconfig.tsbuildinfo" "$CLIENT_DIR/src-tauri/tsconfig.tsbuildinfo" 2>/dev/null || true
# 清理占用端口的旧服务进程（上次未正常退出时：8091=后端, 5173=Vite）
for CLEAN_PORT in 8091 5173; do
  #用于检查某个命令是否存在，以及它的位置。
  if command -v lsof >/dev/null 2>&1; then
    #用于检查某个端口是否被占用，并返回占用该端口的进程ID。
    OLD_PIDS=$(lsof -ti tcp:"$CLEAN_PORT" 2>/dev/null || true)
    if [ -n "$OLD_PIDS" ]; then
      warn "端口 $CLEAN_PORT 被占用 (PID: $OLD_PIDS)，正在终止旧进程..."
      echo "$OLD_PIDS" | xargs kill -9 2>/dev/null || true
      sleep 1
    fi
  fi
done
ok "缓存清理完成"

if [ "$CLEAN" -eq 1 ]; then
  info "深度清理：重新安装依赖（npm install）..."
  (cd "$CLIENT_DIR" && npm install)
  ok "依赖安装完成"
fi

# ---------- 2. 检查 dmcode-server ----------
if [ ! -d "$SERVER_DIR" ]; then
  PARENT_DIR="$(cd "$CLIENT_DIR/.." && pwd)"
  echo ""
  fail "未找到 dmcode-server 工程！
  预期路径: $SERVER_DIR
  请将 dmcode-server 下载/克隆到 damaocode-client 的【同层级】目录下:
      cd $PARENT_DIR
      git clone <dmcode-server 仓库地址>
  即最终目录结构为:
      $PARENT_DIR/
      ├── damaocode-client/   <- 当前工程
      └── dmcode-server/   <- 需要放在这里"
fi
ok "找到 dmcode-server: $SERVER_DIR"

# ---------- 3. 检查基础工具 ----------
command -v node >/dev/null 2>&1 || fail "未检测到 node，请先安装 Node.js (>=18)"
command -v npm  >/dev/null 2>&1 || fail "未检测到 npm"

# ---------- 4. 选择 Java 运行时（优先系统 Java 17+，其次工程内置 JRE） ----------
BUNDLED_JRE="$CLIENT_DIR/resources/agent/runtime"
JAVA_BIN=""
if command -v java >/dev/null 2>&1; then
  JAVA_BIN="java"
elif [ -x "$BUNDLED_JRE/bin/java" ]; then
  JAVA_BIN="$BUNDLED_JRE/bin/java"
  export PATH="$BUNDLED_JRE/bin:$PATH"
  ok "使用工程内置 JRE: $BUNDLED_JRE"
else
  fail "未检测到 Java (需要 17+)。
  可安装 Temurin 17: https://adoptium.net/
  或在客户端工程执行 npm run agent:runtime 下载内置 JRE 后重试。"
fi

JAVA_VER_OUTPUT="$("$JAVA_BIN" -version 2>&1 | head -1)"
if echo "$JAVA_VER_OUTPUT" | grep -q '"1\.'; then
  fail "当前 Java 版本过低（$JAVA_VER_OUTPUT），Spring Boot 3.4 需要 Java 17+。"
fi
ok "Java: $JAVA_VER_OUTPUT"

# ---------- 5. 检测 jar 是否存在 / 是否需要重新构建 ----------
JAR_FILE="$SERVER_DIR/dmcode-server-app/target/dmcode-server.jar"
NEED_BUILD=0

if [ "$REBUILD" -eq 1 ]; then
  NEED_BUILD=1
  info "已指定 --rebuild，将强制重新构建 jar"
elif [ ! -f "$JAR_FILE" ]; then
  NEED_BUILD=1
  info "未找到 jar 包，需要构建"
else
  # 检测是否有比 jar 更新的源码/配置（即 jar 已过期）
  NEWER_SRC=$(find "$SERVER_DIR" \
    \( -name "*.java" -o -name "pom.xml" -o -name "*.yml" \) \
    -newer "$JAR_FILE" -not -path "*/target/*" -print -quit 2>/dev/null || true)
  if [ -n "$NEWER_SRC" ]; then
    NEED_BUILD=1
    info "检测到 jar 包不是最新（源码有更新: ${NEWER_SRC#$SERVER_DIR/}），将重新构建"
  else
    ok "jar 包已是最新: $JAR_FILE"
  fi
fi

if [ "$NEED_BUILD" -eq 1 ]; then
  if ! command -v mvn >/dev/null 2>&1; then
    if [ -f "$JAR_FILE" ]; then
      warn "未检测到 mvn，跳过构建，使用现有 jar: $JAR_FILE"
    else
      fail "未检测到 mvn 且没有现成 jar，无法启动后端。请安装 Maven: https://maven.apache.org/"
    fi
  else
    info "正在构建服务端 jar（mvn -DskipTests package，首次可能较慢）..."
    (cd "$SERVER_DIR" && mvn -q -DskipTests package) || fail "服务端构建失败，请检查 dmcode-server 代码"
    ok "服务端构建完成: $JAR_FILE"
  fi
fi

# ---------- 6. 启动后端 ----------
if [ "$START_SERVER" -eq 1 ]; then
  info "启动后端服务 (profile=local, port=$PORT)，Spring Boot 启动约需 40-60 秒，请稍候..."
  info "日志文件: $LOG_FILE"
  (cd "$SERVER_DIR" && nohup "$JAVA_BIN" -jar "$JAR_FILE" \
      --spring.profiles.active=local --server.port="$PORT" \
      > "$LOG_FILE" 2>&1 & echo $! > "$PID_FILE")

  READY=0
  #循环最多执行 120 次。每次循环相当于等待一秒左右。所以总体等待上限约为 120 秒。
  for i in $(seq 1 120); do
    if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
      exec 3>&- 3<&- 2>/dev/null || true
      READY=1; break
    fi
    if ! kill -0 "$(cat "$PID_FILE" 2>/dev/null)" 2>/dev/null; then
      echo ""
      fail "后端进程异常退出，最近日志:
$(tail -30 "$LOG_FILE")"
    fi
    sleep 1
  done

  [ "$READY" -eq 1 ] || fail "等待后端启动超时（120s），请查看日志: $LOG_FILE"
  ok "后端已就绪: http://localhost:$PORT (PID: $(cat "$PID_FILE"))"
else
  warn "跳过后端启动（--no-server）"
fi

# ---------- 7. 启动桌面客户端（Tauri） ----------
if [ ! -d "$CLIENT_DIR/node_modules" ]; then
  info "未检测到 node_modules，正在安装依赖..."
  (cd "$CLIENT_DIR" && npm install)
  ok "依赖安装完成"
fi

command -v cargo >/dev/null 2>&1 || fail "未检测到 cargo (Rust)，桌面客户端需要 Rust 环境。
  安装: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"

if [ "$START_CLIENT" -eq 1 ]; then
  info "启动桌面客户端 (Tauri dev)，稍后 DaMaoCode 桌面窗口将自动弹出..."
  # 退出时（关闭窗口或 Ctrl+C）自动回收后端进程
  cleanup() {
    #获取后端进程ID
    SERVER_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
    #如果后端进程ID存在，并且该进程还在运行，则停止该进程
    if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
      info "正在停止后端进程 (PID: $SERVER_PID)..."
      kill "$SERVER_PID" 2>/dev/null || true
    fi
  }
  trap cleanup EXIT INT TERM
  cd "$CLIENT_DIR"
  npm run tauri dev
  ok "桌面客户端已退出"
else
  ok "全部完成（--no-client，桌面客户端未启动）"
fi
