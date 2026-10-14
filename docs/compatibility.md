# 转换契约与检查报告

浏览器和 Node CLI 共用 `js/converter.js`。该核心先选择一页、映射节点和尺寸，再生成诊断、导出参数与预览。Windows COM 通道是独立的实验性实现，不在这一契约的完整验证范围内。

## 保留、统一和简化

- 保留：节点 ID 对应关系、纯文字、分支连接的源/目标关系、原节点中心的相对位置。
- 统一：流程图样式、字号、主题字体、结束箭头；选用标准尺寸时，各类型框的宽高。
- 简化：数据库、数据、文档及复杂形状成为矩形；文字富格式成为纯文字；图片不嵌入；嵌套分组和泳道不完整还原。
- 布线：输出两端吸附关系及 `_WALKGLUE`、`_XFTRIGGER`、`GUARD` 等公式，Visio 可在打开或编辑时重新求解。SVG 只绘制输出尺寸下的静态端点快照。

流程、起止、判定分别引用内置 Master 5、4、7；连接线引用 Master 6。标签不引用母版。自定义尺寸 profile 可以改变尺寸和字号，但当前 VSDX 引擎不能加载任意外部 `.vssx` 替换这些母版。

主题字体与主题填充仍保留公式绑定；边线和文字颜色采用受保护的黑色。改变主题不意味着每个视觉属性都随主题变化。

## 首次打开时连线凌乱

维护者反馈的实用操作是：用 Visio 打开转换后的 `.vsdx`，在绘图页中全选全部内容，轻微拖动并松开，让 Visio 重新计算连接位置与线路。再用横向、纵向间距及对齐命令整理主干与分支，可减少逐个节点调整的工作。

这一操作会触发编辑更新，但不等同于保证所有复杂图形自动得到最优布局。若仍有交叉、绕路或标签遮挡，继续检查相关分支；若源文件本身丢失了连线引用，拖动也无法补回缺失的关系。完整步骤见 [截图重绘与 Visio 整理指南](screenshot-to-visio.md)。

## 报告字段

| 字段 | 语义 |
|---|---|
| `status` | `ready` 未发现兼容性警告；`review` 有警告；`error` 有输入错误 |
| `summary` | 输入/输出节点和连线计数、警告项数量 |
| `selectedPage` / `sourcePages` | 选中页码与源页数 |
| `issues[].code` | 稳定的机器可读检查码 |
| `issues[].ids` | 对应源节点或源连线 ID |
| `shapes[]` | 输入分类、输出分类、母版名和实际英寸尺寸 |
| `options` | 实际生效的尺寸和字号 |

报告和配置只记录输入文件名。报告的页名、ID 等仍来自输入；分享报告前应检查这些字段。CLI 输出中的 `input` 和输出路径可包含绝对路径。

## 检查码

| 级别 | 代码 | 处理方法 |
|---|---|---|
| error | `EMPTY_PAGE` | 选择包含节点的页面 |
| error | `DUPLICATE_ID` | 修复缺失或重复的节点 ID |
| error | `INVALID_GEOMETRY` | 使用有限坐标和正宽高 |
| warning | `SHAPE_SIMPLIFIED` | 接受矩形简化，或改用简单流程图节点 |
| warning | `EDGE_OMITTED` | 补齐有效的 source/target 引用 |
| warning | `ROUTE_REBUILT` | 在 Visio 中检查重新求解的线路 |
| warning | `ARROW_STANDARDIZED` | 检查统一为单向结束箭头后是否仍符合原意 |
| warning | `NESTED_GEOMETRY` | 展开父子坐标、拆组后转换 |
| warning | `IMAGE_OMITTED` | 改用原生简单图形，或交付后人工补图 |
| warning | `ROTATION_RESET` | 在 Visio 中确认角度 |
| warning | `SWIMLANE_SIMPLIFIED` | 拆分泳道语义后再转换 |
| warning | `TEXT_MAY_OVERFLOW` | 加宽/加高、减字号；估算不是渲染证明 |
| warning | `SHAPES_OVERLAP` | 调整源布局或统一尺寸；标签不参与此检查 |
| info | `STYLE_STANDARDIZED` | 原始颜色和富文本格式按标准流程图样式统一 |

严格模式拒绝所有 warning/error，info 不阻止转换。普通模式拒绝 error，但允许 warning 并保存报告。任何模式都不把 `ready` 等同于 Visio 视觉验证通过。

## 已验证与尚未验证

自动测试读取真实输出 ZIP，检查母版引用、各节点及连线的字号、两端 Connect、关键文字和元数据；再故意破坏引用和包结构确认校验器失败。浏览器手动验收覆盖加载示例、切换预设和严格模式阻止导出。

尚未建立跨 Visio 版本的视觉基准；复杂图形、多页 VSDX、VDX 和 COM 通道也未获得同等验证。SVG 配图与网页预览不能替代 Microsoft Visio 打开、移动节点、修改尺寸、修改主题后的人工验收。
