# AI Agent 调用指南（Drawio2Visio）

给 AI / 自动化：**最少步骤**完成 Draw.io → Visio。

只有截图时，先阅读 [截图重绘工作流](screenshot-to-visio.md)，把截图、补充文字和 [可复制的 Agent 提示词](../prompts/screenshot-to-drawio.zh-CN.txt) 一起提供给支持看图的 Agent。它负责生成 `.drawio`；本项目再负责转换。用户也可以直接在 Draw.io 绘制。

## 职责划分

| 角色 | 做什么 |
|------|--------|
| **AI** | 收 `.drawio` → 可选改尺寸/字号 → 调 CLI → 回传 vsdx |
| **用户** | 提图与特殊要求；在 Visio 里微调布线/个别框 |

无特殊要求时，**直接用默认美观预设**，不必逐项问用户。

## 一键命令

```bash
cd /path/to/drawio2visio
npm ci             # 首次：按锁文件安装 @xmldom/xmldom
node scripts/convert.js INPUT.drawio -o OUTPUT_BASE --json
```

可选参数：

```text
--preset beauty|compact     # 预设（默认 beauty）
--set processWidth=2.4      # 覆盖单项（in）
--set processHeight=0.45
--set decisionWidth=2.2
--set decisionHeight=0.5
--set startEndWidth=1.3
--set fontSizePt=10
--profile templates/publication-profile.json --preset paper
--page 2                    # 多页输入必须选一页
--strict                    # 警告存在时拒绝导出
--report-only               # 只分析，不写产物
--json                      # 机器可读结果（路径、统计、所用尺寸）
```

校验（建议总是跑）：

```bash
python3 scripts/check_vsdx.py OUTPUT_BASE.vsdx
```

可选与手绘基准比结构：

```bash
python3 scripts/compare_vsdx.py <手绘.vsdx> OUTPUT_BASE.vsdx
```

## 何时改尺寸（决策规则）

| 情况 | 动作 |
|------|------|
| 用户未指定 | `beauty` 预设，**不要问** |
| 文案很长（≥13 汉字） | `--set processWidth=3.0` 或 `3.2` |
| 用户说「紧凑 / 论文插图」 | `--preset compact` |
| 用户给了具体 mm/in | `--set` 写入 |
| 多列并行很挤 | 查看 SHAPES_OVERLAP，调整源布局或选 compact；工具不自动重排 |

字号默认 8pt；用户强调「大一点」→ `fontSizePt=10`。

## 产出

```text
*.vsdx        主交付（Visio 可编辑）
*.vdx         备用
*-visio.svg   快速预览
*-config.json 本次所用参数（便于复现）
*-report.json 转换简化、遗漏、源 ID、实际尺寸和计数
```

## 端到端示例（AI 可直接复制）

```bash
node scripts/convert.js \
  examples/review-flow.drawio -o outputs/review --json --set processWidth=2.2

python3 scripts/check_vsdx.py outputs/review.vsdx
```

失败时：先看 check_vsdx 输出，再读 `docs/compatibility.md`。

## 成功状态的解释

`--json` 在成功和失败时都输出结构化结果。先检查退出码及 `ok`，再检查 `report.status`：

- `ready`：当前输入检查未发现警告，仍需在目标 Visio 中检查视觉与编辑效果。
- `review`：允许普通导出，但必须告知使用者有哪些形状简化或连线遗漏。
- `error`：输入无效，不应交付产物。

`--strict --json` 可用作自动化门槛；失败时的 `report.issues` 指出相关源 ID。`--report-only` 输出分析结果，不创建 VSDX。

Python 包装器也支持 `--strict`、`--report-only`、`--profile`、`--page`，转换后会调用结构检查器。`--quiet` 结果包含 `check_ok`、报告路径和警告数量。不要把结构检查通过写成“已在 Visio 中验证”。

## 绘制侧约定

输入规则见 `docs/compatibility.md`（标准 mxfile；起止 ellipse / 流程矩形 / 判定 rhombus）。

## 交付后的 Visio 整理

在交付说明里提醒用户：如果首次打开生成的 `.vsdx` 时连线显示凌乱，可以全选画布上的内容，轻微拖动并松开，以触发 Visio 重新计算；随后通过对齐及横向/纵向间距整理版面。分支或循环较多时，可按主干与侧支分别整理。

这是维护者的使用经验，不应在未打开目标 Visio 实测时写成“所有线路已整齐排布”。需要保留的文字、方向和连线关系仍须核对。详细操作见 [工作流指南](screenshot-to-visio.md)。
