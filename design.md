# Design

本文件是本仓库的 UI 设计规范。新增或调整任何 UI 元素前，先看实际代码中的 `src/index.css`、`src/styles/*` 和本文件；当文档与代码不一致时，先以代码为准，再更新本文档。

## Design Direction

- 产品形态是 AI-native infinite canvas，不是营销页或传统后台。
- 第一屏应直接呈现可操作画布、工具栏、节点和输入器。
- 视觉目标是轻、干净、可扫读，让 Agent 执行链和图片结果成为焦点。
- 新增 UI 元素的设计风格必须与当前界面统一，不允许另起一套视觉语言。

## Design Tokens

- Tailwind v4 是 CSS-first：稳定、重复使用的颜色、尺寸、圆角、阴影和节点字号统一维护在 `src/styles/theme.css` 的 `@theme` 中，使用官方 namespace：`--color-*`、`--radius-*`、`--shadow-*`、`--spacing-*`、`--text-*`。
- `src/index.css` 是唯一 Tailwind CSS entry，只负责按顺序 `@import` Tailwind、动画库和 `src/styles/` 下仍需要全局选择器的样式文件；普通页面、输入器和简单面板样式优先直接写在组件 `className`。
- `:root` 只保留 shadcn/ui 语义变量和运行时组件变量，例如 `--cuc-width-composer`；新增重复视觉值先补 `@theme` token，再引用 token。
- token 组织只参考 Geist 的分层格式，数值以当前 Cucumber/Flowith 画布视觉为准，不直接套用 Geist 数值。

## Style Architecture

- `src/index.css` 只保留 `@import`（Tailwind、动画库、`src/styles/*`）、`@source` 和 `@custom-variant`，不直接写产品样式。
- `src/styles/theme.css` 维护 `@theme`、`@theme inline`、`:root` 和需要 token 的 `@utility`（如 `cuc-checkerboard`）。
- `src/styles/base.css` 用 `@layer base` 放 `html`、`body`、`#root`、字体、滚动条和基础表单继承，以及全局 `@keyframes` 和 `@utility` 动画（如 `animate-star-sparkle`）。
- 产品样式按域拆分为独立文件：`canvas-shell.css`、`run-node.css`、`artifacts.css`、`trace-panel.css`；静态组件 UI 优先写在组件 `className`，CSS 只保留全局选择器、第三方覆盖、伪元素、keyframes、mask 和深层后代选择器，不要在 `src/App.tsx` 或其他组件里重新引入全局样式入口。
- 不要把完整产品域样式整体包进 `@layer components`，否则 JSX 中已有 Tailwind utilities 会覆盖 `.run-*`、`.artifact-*` 等产品 class，造成视觉回退。
- `workspace-pages.css` 只保留仍需要资源 mask 的 `cucumber-send-icon`；Home、Project、Skills 页面和 app loading/error 状态样式写在各自组件 `className`。
- `canvas-shell.css` 只保留 React Flow 内部选择器（如 `.react-flow__pane`、selection、handle、edge）；shell、top bar、tool rail、viewport controls、file drop overlay 直接写在组件 `className`。
- 画布输入器、图像模式 controls、inline token 和 skill menu 样式写在 `CanvasWorkspace.tsx` 的局部 Tailwind className 常量中；不要恢复 `composer.css`。
- 基础节点样式由 `src/components/ai-elements/node.tsx` 的 `Node` 和基础节点组件 className 管理，并继续提供 `--canvas-node-*` 变量给 `run-node.css` 与 `artifacts.css`。
- `run-node.css` 管理 `run-*`、`agent-*`、`tool-call-*`、`tool-json-*`。
- `artifacts.css` 管理 image / markdown / code / html artifact、preview dialog、BlockNote 覆盖和透明棋盘格。
- `trace-panel.css` 只保留 trace 事件列表、debug raw 输出和 chip 等深层/重复结构；Trace 面板外壳、header、actions、state、section 和 replay banner 写在 `RunTracePanel.tsx` 的局部 Tailwind className 常量中。
- 不新增 `common.css`、`responsive.css` 这类垃圾桶文件；media query 跟随所属产品域文件。
- 简单新增 UI 可以直接使用 Tailwind utility，例如 `bg-cuc-surface rounded-cuc-card border border-cuc-border`；React Flow、BlockNote、伪元素、复杂后代选择器继续留在对应 `src/styles/*` 文件。
- `@utility` 只用于 Tailwind theme token 不能自然表达的能力，例如 `cuc-checkerboard`；阴影、颜色、尺寸、圆角优先放进 `@theme`。

## Color

当前 UI 语言以 Flowith 参考画板的浅灰画布和轻量浮层为核心：

- 外层背景：`#ffffff`，画布外留 6px 白色边界。
- 画布背景：`#f2f3f4`，画布容器边框 `#f1f2f4`，圆角 6px。
- 主色：`#29bf4e`，用于品牌标识、提交按钮、选中态和关键状态。
- 主色文字：`#07130a` / `#06100a`。
- 辅助高亮：`#f8ffbf`，当前 Run 节点使用该色。
- 常规面板：`#ffffff`。
- 画布节点底色：`#e8eaee`，边框 `rgba(141, 149, 165, 0.24)`。
- 常规边框：`#e2e4e8`、`#ebebeb`、`#e8e7e4` 或 token `--border`。
- 正文文字：`#111111`、`#0a0a0a`。
- 弱文本：`#737373`、`#7d7d7a`、`#555555`。
- 错误色：`#e5484d` / `#cc2e33`。

不要新增与当前浅色画布冲突的深色主题、重渐变、大面积紫蓝色或强营销感配色。

## Typography

- 字体沿用系统无衬线栈：Inter、system-ui、Apple 系统字体等。
- 默认字号约 14px；首页、顶栏、工具和项目列表的常规说明文字多为 10-13px。
- 画布节点内部使用更紧凑的 Flowith 参考比例：标题约 9px / 14px，正文约 8px / 12.5px，meta 约 7px / 9px，默认内边距约 23px。
- 字距保持 `0`，不要使用负字距。
- 不按 viewport 动态缩放字号。
- 画布节点文案要短、可扫读；长内容使用截断、换行或 tooltip，不让文本撑破布局。
- 中文产品文案优先，默认 UI 不暴露 raw id、toolCallId、transactionId 等调试字段。

## Layout

- 页面主体是全屏画布，尺寸为 `100vw` x `100vh`。
- 顶栏位于左上，保持轻量品牌标识和标题，不扩展成大导航。
- 左侧工具栏为 56px 宽、20px 圆角的垂直浮层，居中悬浮，工具按钮为 40px 图标按钮。
- 右上 viewport controls 为 48px 高、16px 圆角的横向浮层，承载自动布局、缩放和创作台入口。
- 左上项目信息为 48px 高、16px 圆角的轻量浮层，包含品牌、标题和快捷动作。
- 底部输入器居中悬浮，宽度为 `min(600px, calc(100vw - 48px))`；Agent 模式保持约 53px 紧凑高度，图像模式展开为约 185px，并在输入器顶部提供 Agent / 图像模式切换。
- Canvas 节点默认宽度约 218px；图片结果节点以 218px 为基准宽度，并按图片真实宽高比计算容器高度。
- 图片结果、Run 节点、Prompt 节点应保持稳定默认尺寸，状态变化不能造成明显跳动；用户选中节点后可以通过绿色缩放手柄调整尺寸。
- 移动端要优先保证底部输入器、左侧工具栏和右上 viewport controls 不互相遮挡。

## Shape And Elevation

- 主要交互控件使用圆形或胶囊形。
- 工具栏按钮尺寸约 40px，圆角约 16px。
- 顶部浮层高度约 48px，圆角约 16px。
- 底部输入器高度约 53px，圆角约 20px。
- 节点卡片圆角约 28px；图片结果节点圆角 10px。
- 节点保持无厚重投影；输入器使用 `0 6px 6px rgba(41, 37, 100, 0.04)` 一类轻阴影。
- 不做厚重投影、嵌套卡片、装饰性大卡片堆叠或渐变背景装饰。

## Components

- 新按钮优先使用 `lucide-react` 图标，并提供 `aria-label` / `title`。
- 明确动作优先用图标按钮：选择、缩放、图层、图片、插入、连接等不要用冗长文字按钮。
- 复用 `src/components/ui/*` 和 `src/components/ai-elements/*`，不要临时复制一套组件风格。
- 画布节点应继续基于 `Node` / `NodeContent` 等 AI Elements 包装组件。
- 表单输入优先复用 Prompt Input / Input Group 的圆角、边框和轻阴影语言。
- 画布输入器内展示选中节点 token，不展示 raw node id；图像模式参数使用轻量下拉控件承载模型、比例和数量。
- 浮层、弹窗和菜单保持轻量，不遮挡核心画布操作。
- 文件拖拽上传只在拖拽悬停或错误时显示轻量提示层；使用浅绿色虚线边界、白色胶囊提示和现有错误色，不作为默认信息层常驻。

## Project And Auth Pages

- 登录页和项目列表页是工作入口，不做营销页、hero 或大段说明。
- 首页同样是工作入口：使用 `#f2f3f4` 浅灰工作区、居中 600px 输入器和轻量项目网格，不做大标题营销首屏。
- 首页品牌/用户信息使用 48px 高、16px 圆角的轻量浮层；首页输入器复用画布底部输入器语言：`min(600px, calc(100vw - 108px))`、约 53px 高、20px 圆角、`#e2e4e8` 细边框和 `0 6px 6px rgba(41, 37, 100, 0.04)` 阴影。
- 登录表单沿用浅暖灰背景、白色轻面板、绿色主动作和短中文文案。
- 首页最近项目和项目列表都使用轻量重复项目卡片，展示项目名、节点数、图片数和更新时间；不显示 raw id。
- 项目卡片圆角不超过 8px，背景以白色卡片和浅灰画布缩略预览为主；没有真实缩略图时使用中性节点/连线预览，不使用大面积彩色渐变占位。
- 项目列表动作优先使用 `lucide-react` 图标按钮；新建项目可以使用图标+短文字按钮。
- 删除项目为软删除，界面默认只隐藏项目，不展示恢复入口。
- 项目页和技能页使用同一套工作区结构：`#f2f3f4` 背景、居中内容容器、48px 高 / 16px 圆角的页面 header、白色 8px 圆角面板和 `#e2e4e8` 细边框。
- 技能页是密集编辑工具，不做卡片堆叠装饰；列表、详情、资源预览都使用白色轻面板，操作按钮使用 32px 高、12px 圆角，主动作保留 `#29bf4e`。

## Canvas Nodes

- Prompt node：白色卡片，短内容居中展示；长内容按文本估算默认高度，选中后通过绿色缩放手柄调整尺寸时显示完整可滚动文本。
- Run node：淡黄绿色卡片，Agent 对话是主内容；计划进度、handoff/skill 摘要和工具调用作为 Agent 执行流附属展示，图片等产物由结果节点承载，不在 Run 卡里作为主摘要重复展示。默认保持紧凑，详细参数放在可展开工具行。
- Image result node：图片卡片圆角 10px，按真实宽高比展示，图片铺满容器并保持 `object-fit: cover`；透明底图片透出 PS 风格棋盘格背景。
- Non-image artifact node：文档、Markdown、代码和网页等文本型产物使用白色 8px 圆角卡片；顶部约 32px 浅灰标题栏，左侧显示文件名和类型后缀，右侧仅放复制、下载图标按钮；下方内容区展示实际文档、代码或网页预览，图片节点继续使用独立样式。
- 选中态使用绿色边框和浅绿色外发光，不新增冲突颜色。
- 节点缩放手柄仅在选中态显示，使用当前绿色主色和轻量边线，不常驻占用默认信息层级。
- Follow-up 操作保持贴近选中图片结果，不占据默认信息层级。
- 工具错误应在 Run node 中可见，但保持短文案；详细诊断放到明确的高级入口。

## Copy

当前界面以中文产品文案为主，英文仅用于必要的工具名或 API 名：

- 输入需求，让 Agent 生成图片...
- 基于选中结果继续修改...
- 引用结果
- 输入需求，让 Agent 帮你实现...

新增文案应短、直接、可操作。不要在界面中解释功能规则、快捷键或内部实现细节。

## UI Checklist

新增 UI 前检查：

- 是否复用了现有 token、组件、尺寸、间距、圆角和阴影。
- 是否与浅暖灰画布、亮绿色主色、淡黄绿色 Run 节点保持一致。
- 是否在桌面和移动端都不会遮挡底部输入器、左侧工具栏和右上 controls。
- 文本是否不会溢出、重叠或撑大固定格式 UI。
- 默认界面是否隐藏了内部 raw id 和调试字段。
- 交互控件是否有可访问名称。
