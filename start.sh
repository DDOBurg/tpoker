#!/usr/bin/env bash
# TPoker 一键启动：启动本地服务并打印局域网访问信息
cd "$(dirname "$0")"
PORT=8000

PYBIN=""
PYARGS=""
for cand in python3 python py; do
  if command -v "$cand" >/dev/null 2>&1; then
    PYBIN="$cand"; break
  fi
done
if [ -z "$PYBIN" ] && command -v uv >/dev/null 2>&1; then
  PYBIN="uv"; PYARGS="run --no-project python"
fi
if [ -z "$PYBIN" ]; then
  echo "[错误] 未找到 Python 3（也未找到 uv）。请先安装 Python 3。"
  exit 1
fi

echo "============================================"
echo "  TPoker 本地服务启动中..."
echo "============================================"
echo
echo "局域网地址（手机与电脑连同一 Wi-Fi 后访问其中一个）："
(ipconfig 2>/dev/null || ifconfig 2>/dev/null || hostname -I 2>/dev/null) | grep -Eo '([0-9]{1,3}\.){3}[0-9]{1,3}' | grep -v -E '^(127\.|169\.254|255\.)' | sort -u
echo
echo "本机测试地址：  http://127.0.0.1:${PORT}/"
echo
echo "提示："
echo "  1. iPhone Safari 打开上面的局域网地址"
echo "  2. 点"分享"按钮 -> "添加到主屏幕""
echo "  3. 之后从桌面图标打开即可完全离线使用"
echo "  4. 首次加载后应用自动缓存全部资源；内容更新需连同一 Wi-Fi 刷新一次"
echo
echo "按 Ctrl+C 停止服务。"
echo
exec $PYBIN $PYARGS -m http.server "$PORT" --bind 0.0.0.0
