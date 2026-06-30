# Design

本文件是本仓库的 UI 设计规范。新增或调整任何 UI 元素前，先看实际代码中的 `src/index.css`、`src/styles/*` 和本文件；当文档与代码不一致时，先以代码为准，再更新本文档。

## Design Direction

- 新增 UI 元素的设计风格必须与当前界面统一，不允许另起一套视觉语言。

## Design Tokens

- Tailwind v4 是 CSS-first：稳定、重复使用的颜色、尺寸、圆角、阴影和节点字号统一维护在 `src/styles/theme.css` 的 `@theme` 中，使用官方 namespace：`--color-*`、`--radius-*`、`--shadow-*`、`--spacing-*`、`--text-*`。
- `src/index.css` 是唯一 Tailwind CSS entry，只负责按顺序 `@import` Tailwind、动画库和 `src/styles/` 下仍需要全局选择器的样式文件；普通页面、输入器和简单面板样式优先直接写在组件 `className`。
- `:root` 只保留 shadcn/ui 语义变量和运行时组件变量，例如 `--cuc-width-composer`；新增重复视觉值先补 `@theme` token，再引用 token。

<br />

## Style Authoring Rule

样式的默认目标是让 80% 的元素在代码现场可读，只有设计语言或复杂选择器才需要跳转：

- 元素布局、尺寸、间距、对齐、定位、响应式、hover / disabled / selected 等局部状态，优先直接写在组件 `className` 或组件内局部 className 常量中。
- 只有同一组 class 在多个文件反复出现，并且代表明确产品语义时，才抽成小的 `@utility` 或组件内共享常量；不要为了“语义化”把一次性的布局封装成 `.cuc-panel`、`.cuc-card` 这类需要跳 CSS 的 class。
- 如果改一个元素时必须连续跳 `组件 -> CSS -> theme` 才能看懂布局，优先把布局和普通视觉移回组件 `className`，只保留真正需要 CSS 的部分。

<br />

## Shape And Elevation

- 主要交互控件使用圆形或胶囊形。
- 工具栏按钮尺寸约 40px，圆角约 16px。
- 顶部浮层高度约 48px，圆角约 16px。
- 底部输入器为 Prompt Input 浮动卡片，Agent 模式高度约 168px，图像模式高度约 185px，圆角约 20px。
- 节点卡片圆角约 28px；图片结果节点圆角 10px。
- 节点保持无厚重投影；输入器使用 `0 6px 6px rgba(41, 37, 100, 0.04)` 一类轻阴影。
- 不做厚重投影、嵌套卡片、装饰性大卡片堆叠或渐变背景装饰。

## Components

- 明确动作优先用图标按钮：选择、缩放、图层、图片、插入、连接等不要用冗长文字按钮。
- 复用 `src/components/ui/*` 和 `src/components/ai-elements/*`，不要临时复制一套组件风格。
- 画布节点应继续基于 `Node` / `NodeContent` 等 AI Elements 包装组件。
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
- 是否与浅暖灰画布、亮绿色主色、淡黄绿色 Run 节点保持一致。
- 文本是否不会溢出、重叠或撑大固定格式 UI。
- 默认界面是否隐藏了内部 raw id 和调试字段。
- 交互控件是否有可访问名称。

