# 可公开、可复现的示例

所有示例内容均为虚构，无真实业务数据或专利材料。

| 文件 | 用途 | 默认转换结果 |
|---|---|---|
| `review-flow.drawio` | 中英审核流程，展示混合原尺寸与两个标准化预设 | 7 个节点、6 条连接线；兼容性检查 ready |
| `compatibility.drawio` | 数据库形状及悬空连线，验证报告/严格模式 | 数据库简化为矩形；1 条无效连线不导出；strict 失败 |

```bash
npm ci
node scripts/convert.js examples/review-flow.drawio -o outputs/review --strict
python3 scripts/check_vsdx.py outputs/review.vsdx --expect "接收申请" --expect "提交审核"
node scripts/convert.js examples/compatibility.drawio --report-only --json
npm run docs:figures
```

`docs/assets/profiles.svg` 使用该输入的原始尺寸/样式示意与转换器真实 SVG 输出组合，未把静态预览标为 Visio 客户端截图。`docs/assets/workbench.jpg` 与 `strict-mode.jpg` 是实际网页截图。

验证编辑效果：用目标 Microsoft Visio 打开 `review.vsdx`，移动“完整？”节点，检查两条分支是否保持吸附；缩放流程节点，检查几何与文字块跟随；保存并重新打开。结构校验不能替代这些操作。
