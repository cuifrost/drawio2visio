#!/bin/bash
# 双击打开 Drawio2Visio 可视化界面
cd "$(dirname "$0")"
if command -v open >/dev/null 2>&1; then
  open "index.html"
else
  python3 -m http.server 8765 --bind 127.0.0.1 >/dev/null 2>&1 &
  sleep 0.5
  open "http://127.0.0.1:8765/index.html"
fi
echo "已在浏览器打开转换器。若未弹出，请手动双击 index.html"
