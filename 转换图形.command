#!/bin/bash
# 双击后按提示输入 .drawio 路径，或把文件拖到本图标上
cd "$(dirname "$0")"
# 依赖解析：优先项目本地 node_modules（npm install 一次即可）；
# 本地缺失时才回退到外部 MIMO_NODE_MODULES
if [ ! -d "node_modules/@xmldom" ] && [ -n "$MIMO_NODE_MODULES" ]; then
  export NODE_PATH="$MIMO_NODE_MODULES"
fi
NODE_BIN="${MIMO_NODE:-$(command -v node)}"
if [ -z "$NODE_BIN" ]; then
  echo "未找到 Node.js，请先安装或设置 MIMO_NODE"
  read -r
  exit 1
fi

if [ -n "$1" ]; then
  IN="$1"
else
  echo -n "请把 .drawio 文件拖到本窗口，或粘贴路径后回车: "
  read -r IN
fi
IN="${IN//\'/}"
[ -z "$IN" ] && echo "未输入文件" && read -r && exit 1

BASE="outputs/$(basename "${IN%.drawio}")"
echo "转换中: $IN"
"$NODE_BIN" scripts/convert.js "$IN" -o "$BASE"
if [ "$?" -ne 0 ]; then
  echo "转换失败，请查看上方提示；没有交付本次结果。"
  read -r
  exit 1
fi
python3 scripts/check_vsdx.py "$BASE.vsdx"
if [ "$?" -ne 0 ]; then
  echo "文件已生成，但结构检查未通过，请勿直接交付。"
  read -r
  exit 1
fi
echo ""
echo "完成 → $BASE.vsdx"
echo "兼容性报告 → $BASE-report.json"
echo "（再次运行此脚本可转换下一张 .drawio）"
read -r
