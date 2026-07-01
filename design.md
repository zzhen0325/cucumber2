# Design

本文件是本仓库的 UI 设计规范。新增或调整任何 UI 元素前，先看实际代码中的 `src/index.css`、`src/styles/*` 和本文件；当文档与代码不一致时，先以代码为准，再更新本文档。

## Design Direction

- 新增 UI 元素的设计风格必须与当前界面统一，不允许另起一套视觉语言。
- 本项目的设计系统不是通用 SaaS 组件库，而是 Infinite Canvas Agent OS 的产品语言：画布、节点、输入器、Agent 执行、工具调用、artifact 和工作区入口必须能互相解释。

<br />

## Source Of Truth

- `design.md` 记录设计规则和维护边界。
- `src/styles/theme.css` 是 token 源，稳定视觉值统一放在 Tailwind v4 `@theme`。
- `src/index.css` 是唯一 Tailwind CSS entry，只负责 import Tailwind、动画库和仍需要全局选择器的 CSS。
- `src/components/ui/*` 是 primitive 层，承载 Button、Dialog、Select、Tooltip、Input 等基础行为。
- `src/components/ai-elements/*` 是 Agent/Canvas 基础层，承载 Node、PromptInput、Task、Tool、Reasoning 等产品通用对象。
- `src/components/design-system/*` 是产品模式层，只放跨画布对象复用的样式合同或小型组合模式，例如 `canvas-patterns.ts`。不要在这里放一次性页面布局。
- Figma UI Kit 是协作和同步镜像，不能覆盖代码事实源；从 Figma 回写时必须映射到上述层级。

## Design Tokens

- Tailwind v4 是 CSS-first：`src/styles/theme.css` 是唯一 token 源，按 primitive、semantic、component、motion 四层维护。
- primitive token 只保存原始值，例如 `--primitive-gray-100`、`--primitive-green-500`；UI className、组件 CSS 和普通样式不得直接引用 primitive。
- semantic token 是 UI 公共语言，并通过 `@theme inline` 暴露 Tailwind utilities，例如 `bg-surface`、`text-text`、`text-muted`、`border-border`、`bg-primary`、`bg-danger`、`rounded-card`、`shadow-popover`。
- component token 承载重复的产品对象尺寸、圆角、阴影和节点字号，例如 `--component-size-control`、`--component-radius-composer`、`--component-shadow-node-selected`。
- motion token 承载重复动画时长和 easing，例如 `--motion-duration-fast`、`--motion-ease-standard`。
- `src/index.css` 是唯一 Tailwind CSS entry，只负责按顺序 `@import` Tailwind、动画库和 `src/styles/` 下仍需要全局选择器的样式文件；普通页面、输入器和简单面板样式优先直接写在组件 `className`。
- 浅色是默认主题；深色通过 `html.dark` 和 `html[data-theme="dark"]` 覆盖 semantic variables；`future` 主题通过 `html[data-theme="future"]` 验证扩展主题路径。新增主题只补 `html[data-theme="<name>"]` 的 semantic 覆盖，不改组件 className。
- shadcn/ui 兼容变量（`--background`、`--foreground`、`--primary` 等）必须映射到 semantic token；基础组件优先使用 shadcn 语义变量或本项目 semantic utilities。
- 允许保留一次性的任意布局值，例如特殊响应式宽度、运行时画布尺寸、第三方组件修正；但颜色、阴影、圆角或状态值不得散落硬编码，新增时先补 semantic/component token。

<br />

## System Layers

1. Foundations: `theme.css`、`base.css` 和全局排版、滚动条、动画 token。
2. Primitives: `src/components/ui/*`，只解决无业务语义的控件行为。
3. Agent Elements: `src/components/ai-elements/*`，解决 Agent OS 的基础对象语义。
4. Product Patterns: `src/components/design-system/*`，收纳跨画布/节点/输入器复用的样式合同。
5. Surfaces: `CanvasWorkspace`、`HomePage`、`ProjectListPage`、`SkillsPage` 等具体页面只组合模式和业务逻辑。

新增 UI 时先判断它属于哪一层；不要把页面一次性样式放进 primitives，也不要把运行时逻辑塞进 design-system 常量文件。

<br />

## Style Authoring Rule

样式的默认目标是让 80% 的元素在代码现场可读，只有设计语言或复杂选择器才需要跳转：

- 元素布局、尺寸、间距、对齐、定位、响应式、hover / disabled / selected 等局部状态，优先直接写在组件 `className` 或组件内局部 className 常量中。
- 只有同一组 class 在多个文件反复出现，并且代表明确产品语义时，才抽成小的 `@utility` 或组件内共享常量；不要为了“语义化”把一次性的布局封装成 `.panel`、`.card` 这类需要跳 CSS 的 class。
- 如果改一个元素时必须连续跳 `组件 -> CSS -> theme` 才能看懂布局，优先把布局和普通视觉移回组件 `className`，只保留真正需要 CSS 的部分。
- 跨多个画布对象复用的产品模式放进 `src/components/design-system/*`，例如 canvas toolbar、composer token、artifact frame、image result toolbar。
- Composer 的具体交互 UI 放在 `src/components/canvas/Composer.tsx`；localStorage key、模式和图像参数解析放在 `src/components/canvas/composer-config.ts`。
- 深层第三方选择器、编辑器内部、React Flow 壳层、iframe/code preview、mask、keyframes 和运行时几何继续留在 CSS 或局部 inline style。
- `CanvasWorkspace.tsx` 超过 1500 行后，新功能优先按职责拆到 composer、canvas chrome、artifact/image node、manual node 或 run trace 相关模块；不要继续把新产品模式堆在一个大文件顶部。

<br />

## Product Object Map

- Canvas Chrome: 顶栏、左侧工具栏、viewport 控件、空态、拖拽上传提示。
- Composer: Agent/图像模式、输入上下文 token、技能菜单、图像参数、提交/停止状态。
- Run Node: prompt、执行阶段、Agent/handoff、tool、artifact、error 和 final output 的可见投影。
- Canvas Node: prompt/manual/run/artifact/image/markdown/code/html 等节点外壳、选中态、resize 边界和连线 handle。
- Artifact: artifact frame、文本/code/html/markdown preview、打开/复制/下载、上传中/失败状态。
- Workspace: Home、Projects、Skills、Auth、Sidebar 的入口布局和项目卡片语言。

新增能力必须落到对应对象，而不是创建一套平行视觉或状态表达。

<br />

## Shape And Elevation

- 主要交互控件使用圆形或胶囊形。
- 工具栏按钮尺寸约 40px，圆角约 16px。
- 顶部浮层高度约 48px，圆角约 16px。
- 底部输入器为 Prompt Input 浮动卡片，Agent 模式高度约 168px，图像模式高度约 185px，圆角约 20px。
- 节点卡片圆角约 28px；图片结果节点圆角 10px。
- 节点保持无厚重投影；输入器使用 `shadow-composer` 一类轻阴影。
- 不做厚重投影、嵌套卡片、装饰性大卡片堆叠或渐变背景装饰。

## Components

- 明确动作优先用图标按钮：选择、缩放、图层、图片、插入、连接等不要用冗长文字按钮。
- 复用 `src/components/ui/*` 和 `src/components/ai-elements/*`，不要临时复制一套组件风格。
- 画布节点应继续基于 `Node` / `NodeContent` 等 AI Elements 包装组件。
- 画布内跨节点复用的 class 合同优先放在 `src/components/design-system/canvas-patterns.ts`，页面私有常量保留在页面文件内。
- 便签节点选中后使用节点局部 toolbar 编辑颜色和字体样式；颜色使用现有便签色 swatch，粗体/斜体/下划线/字号使用图标按钮，不新增全局属性面板。
- 表单输入优先复用 Prompt Input / Input Group 的圆角、边框和轻阴影语言。
- 画布输入器内展示选中节点 token，不展示 raw node id；图像模式参数使用轻量下拉控件承载模型、比例和数量。
- 浮层、弹窗和菜单保持轻量，不遮挡核心画布操作。
- 文件拖拽上传只在拖拽悬停或错误时显示轻量提示层；使用浅绿色虚线边界、白色胶囊提示和现有错误色，不作为默认信息层常驻。

  <br />

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
- 是否放在正确层级：token、primitive、Agent element、product pattern 或 surface。
- 同一个值是否已经出现两次以上；如果是，是否应该补 token 或 product pattern。
- 是否与浅暖灰画布、亮绿色主色、淡黄绿色 Run 节点保持一致。
- 文本是否不会溢出、重叠或撑大固定格式 UI。
- 默认界面是否隐藏了内部 raw id 和调试字段。
- 交互控件是否有可访问名称。
- 是否避免把第三方/editor 深层样式硬搬进组件 className。
- 如果涉及画布、Run、artifact、image 或输入器，是否在浏览器中确认桌面和移动视口不重叠。
