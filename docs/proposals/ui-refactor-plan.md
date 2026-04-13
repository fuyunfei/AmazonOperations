# UI 全面重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将所有 UI 从 inline styles + 手写 HTML 迁移到 Tailwind tokens + shadcn 组件 + AI Elements

**Architecture:** 先重置 shadcn 配置和 CSS 基础（Task 1-2），再逐组件从 inline styles 迁移到 Tailwind + shadcn（Task 3-10）。每个 Task 改一个组件文件，独立可提交。

**Tech Stack:** shadcn/ui (neutral theme), AI Elements, Tailwind CSS, lucide-react

**Spec:** `docs/proposals/ui-refactor-design.md`

---

## Task 1: shadcn 基础设施重置

**Files:**
- Modify: `components.json`
- Modify: `tailwind.config.ts`
- Modify: `src/app/globals.css`

- [ ] **Step 1: 重新初始化 shadcn，启用 CSS variables**

```bash
npx shadcn@latest init -d -f
```

这会覆盖 `components.json`，启用 `cssVariables: true`，生成 shadcn 标准 CSS 变量到 `globals.css`。

- [ ] **Step 2: 恢复自定义字体和动画到 globals.css**

`shadcn init` 会覆盖 globals.css。需要把以下内容加回去（在 shadcn 生成的变量之后）：

```css
/* 在 @tailwind utilities 之后追加 */

body {
  font-family: 'Manrope', 'Noto Sans SC', sans-serif;
  overflow: hidden;
}

/* Scrollbar */
::-webkit-scrollbar { width: 4px; height: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: hsl(var(--border)); border-radius: 2px; }

/* Animations */
@keyframes fadeUp {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes bounce-dot {
  0%, 60%, 100% { transform: translateY(0); }
  30% { transform: translateY(-6px); }
}
.fade-up { animation: fadeUp 0.2s ease forwards; }
.dot-bounce { animation: bounce-dot 1.2s infinite; }
```

- [ ] **Step 3: 清理 tailwind.config.ts 自定义颜色**

移除所有 `colors` 扩展（bg、bubble、selected、hover、border、text、semantic），这些全部由 shadcn CSS 变量替代。保留 `fontFamily` 和 `borderRadius.pill`。

```ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Manrope", "Noto Sans SC", "sans-serif"],
        mono: ["IBM Plex Mono", "monospace"],
      },
      borderRadius: {
        pill: "20px",
      },
    },
  },
  plugins: [],
};
export default config;
```

- [ ] **Step 4: 验证构建**

```bash
npx tsc --noEmit 2>&1 | grep "^src/"
```

Expected: 零错误（CSS 变量变化不影响 TS 编译）

- [ ] **Step 5: 提交**

```bash
git add components.json tailwind.config.ts src/app/globals.css src/lib/utils.ts
git commit -m "chore: 重置 shadcn 基础设施，启用 CSS variables，清理自定义颜色"
```

---

## Task 2: 安装 shadcn 组件 + AI Elements

**Files:**
- Create: `src/components/ui/card.tsx`
- Create: `src/components/ui/table.tsx`
- Create: `src/components/ui/select.tsx`
- Create: `src/components/ui/alert-dialog.tsx`
- Create: `src/components/ui/input.tsx`
- Create: `src/components/ui/textarea.tsx`
- Create: `src/components/ui/separator.tsx`
- Create: `src/components/ui/tooltip.tsx`
- Create: `src/components/ai-elements/message.tsx` (及其他 AI Elements 组件)

- [ ] **Step 1: 安装 shadcn 组件**

```bash
npx shadcn@latest add card table select alert-dialog input textarea separator tooltip badge button scroll-area
```

（badge、button、scroll-area 已存在，会被覆盖为最新版本）

- [ ] **Step 2: 安装 AI Elements**

```bash
npx ai-elements@latest
```

选择安装 Message 相关组件（message, conversation 等）。

- [ ] **Step 3: 验证安装**

```bash
ls src/components/ui/ && ls src/components/ai-elements/ 2>/dev/null
npx tsc --noEmit 2>&1 | grep "^src/"
```

Expected: ui/ 下有所有组件文件，零 TS 错误

- [ ] **Step 4: 提交**

```bash
git add src/components/ui/ src/components/ai-elements/
git commit -m "chore: 安装 shadcn 组件 + AI Elements"
```

---

## Task 3: ProductRail.tsx — 侧边栏导航

**Files:**
- Modify: `src/components/layout/ProductRail.tsx`

当前状态：100% inline styles，手写 nav items with hover state。

目标：全部换成 Tailwind classes + shadcn Button/Separator/Badge/ScrollArea。

- [ ] **Step 1: 重写 ProductRail**

关键改动：
- 删除 `C` 常量对象（硬编码颜色）
- `NavItem` 的 hover/active state 从 inline styles + useState 改为 Tailwind `hover:` / `data-[active=true]:` 
- Logo 区域用 Tailwind classes
- 底部日期用 `text-xs text-muted-foreground`
- Badge（红色告警计数）用 shadcn `Badge` variant="destructive"
- 删除手写 `useState(false)` hover 追踪（Tailwind `hover:` 替代）

颜色映射：
| 旧 (inline) | 新 (Tailwind) |
|---|---|
| `background: "#ffffff"` | `bg-background` |
| `color: "#5c6070"` | `text-muted-foreground` |
| `color: "#3b5bdb"` (active) | `text-primary` |
| `background: "rgba(59,91,219,0.07)"` (active) | `bg-primary/5` |
| `background: "#f0f1f5"` (hover) | `hover:bg-muted` |
| `border: "1px solid #ecedf1"` | `border-border` |
| `color: "#1a1d28"` | `text-foreground` |
| `color: "#969bb0"` | `text-muted-foreground` |

- [ ] **Step 2: 验证构建 + 视觉检查**

```bash
npx tsc --noEmit 2>&1 | grep "^src/"
```

在浏览器中检查：导航栏外观一致，hover/active 状态正常。

- [ ] **Step 3: 提交**

```bash
git add src/components/layout/ProductRail.tsx
git commit -m "refactor: ProductRail — inline styles 迁移到 Tailwind + shadcn"
```

---

## Task 4: FunctionPanel.tsx — 功能 Tab 栏

**Files:**
- Modify: `src/components/layout/FunctionPanel.tsx`

当前状态：100% inline styles，手写 tab items。

- [ ] **Step 1: 重写 FunctionPanel**

关键改动：
- 删除 `useState` hover 追踪，用 Tailwind `hover:bg-muted`
- FuncTabItem inline styles → Tailwind classes
- 面板容器 inline styles → `w-[150px] bg-background border-r flex flex-col shrink-0`
- "功能模块" 标题 → `text-xs font-semibold text-muted-foreground uppercase tracking-wide`

- [ ] **Step 2: 验证 + 提交**

```bash
npx tsc --noEmit 2>&1 | grep "^src/"
git add src/components/layout/FunctionPanel.tsx
git commit -m "refactor: FunctionPanel — inline styles 迁移到 Tailwind"
```

---

## Task 5: ContextPanel.tsx — 右侧文件面板

**Files:**
- Modify: `src/components/layout/ContextPanel.tsx`

当前状态：80% inline styles，手写文件卡片 + 上传按钮。

- [ ] **Step 1: 重写 ContextPanel**

关键改动：
- 容器 inline styles → Tailwind（`w-64` / `w-7` collapsed, `bg-background border-l`）
- 文件卡片 → shadcn `Card`（`Card` + `CardContent`）
- 新鲜度标签 → shadcn `Badge`（fresh=default, ok=secondary, stale=destructive）
- 上传按钮 → shadcn `Button` variant="outline" size="sm"
- 滚动区域 → shadcn `ScrollArea`
- 删除按钮 → shadcn `Button` variant="ghost" size="icon"
- 状态消息颜色：success `text-green-600` → `text-emerald-600`, error → `text-destructive`

- [ ] **Step 2: 验证 + 提交**

```bash
npx tsc --noEmit 2>&1 | grep "^src/"
git add src/components/layout/ContextPanel.tsx
git commit -m "refactor: ContextPanel — Card/Badge/Button/ScrollArea 替换手写"
```

---

## Task 6: OverviewPanel.tsx — 账号总览

**Files:**
- Modify: `src/components/panels/OverviewPanel.tsx`

当前状态：60% Tailwind + 40% inline，手写卡片和表格。

- [ ] **Step 1: 重写 OverviewPanel**

关键改动：
- 总计卡片 → shadcn `Card`（dark 背景保留为 `bg-foreground text-background`）
- 品类卡片 → shadcn `Card` + `CardHeader` + `CardContent`
- 告警标签 → shadcn `Badge`（red=destructive, yellow=warning 用 `bg-amber-100 text-amber-800`）
- loading → shadcn `Skeleton`（如果已安装）或保持 Loader2 spinner
- 所有 inline style 颜色 → Tailwind token classes

- [ ] **Step 2: 验证 + 提交**

```bash
git add src/components/panels/OverviewPanel.tsx
git commit -m "refactor: OverviewPanel — Card/Badge 替换手写卡片"
```

---

## Task 7: KPIPanel.tsx — KPI 汇总

**Files:**
- Modify: `src/components/panels/KPIPanel.tsx`

- [ ] **Step 1: 重写 KPIPanel**

关键改动：
- 汇总网格卡片 → shadcn `Card`
- 数据表格 → shadcn `Table` + `TableHeader` + `TableBody` + `TableRow` + `TableHead` + `TableCell`
- 窗口切换按钮 → shadcn `Button` variant="outline" / "default"
- ACOS 高值标红 → `text-destructive`
- 所有 inline styles → Tailwind classes

- [ ] **Step 2: 验证 + 提交**

```bash
git add src/components/panels/KPIPanel.tsx
git commit -m "refactor: KPIPanel — Card/Table/Button 替换手写"
```

---

## Task 8: AlertsPanel.tsx — 每日告警

**Files:**
- Modify: `src/components/panels/AlertsPanel.tsx`

- [ ] **Step 1: 重写 AlertsPanel**

关键改动：
- 告警卡片 → shadcn `Card` + `CardContent`
- 级别标签 → shadcn `Badge` variant（red=destructive, yellow=custom `bg-amber-100 text-amber-800`, green=`bg-emerald-100 text-emerald-800`）
- 过滤按钮 → shadcn `Button` variant="outline" / "default"
- 建议文本 → `Separator` 分隔，移除 💡 emoji，用 lucide `Lightbulb` icon
- 所有 inline styles → Tailwind classes

- [ ] **Step 2: 验证 + 提交**

```bash
git add src/components/panels/AlertsPanel.tsx
git commit -m "refactor: AlertsPanel — Card/Badge/Button 替换手写"
```

---

## Task 9: AdsPanel.tsx + InventoryPanel.tsx — 广告优化 + 库存看板

**Files:**
- Modify: `src/components/panels/AdsPanel.tsx`
- Modify: `src/components/panels/InventoryPanel.tsx`

- [ ] **Step 1: 重写 AdsPanel**

关键改动：
- 两个表格 → shadcn `Table`
- 状态标签 → shadcn `Badge`
- 切换按钮 → shadcn `Button`
- 所有 inline styles → Tailwind

- [ ] **Step 2: 重写 InventoryPanel**

关键改动：
- 库存表格 → shadcn `Table`
- 库存状态 → shadcn `Badge`（critical=destructive, warning=amber, ok=emerald）
- 所有 inline styles → Tailwind

- [ ] **Step 3: 验证 + 提交**

```bash
git add src/components/panels/AdsPanel.tsx src/components/panels/InventoryPanel.tsx
git commit -m "refactor: AdsPanel + InventoryPanel — Table/Badge 替换手写"
```

---

## Task 10: ChatPanel.tsx — AI Elements 集成

**Files:**
- Modify: `src/components/panels/ChatPanel.tsx`

这是最大的组件（598 行），改动最多。

- [ ] **Step 1: Session 列表区域重构**

关键改动：
- 滚动容器 → shadcn `ScrollArea`
- "新建对话" → shadcn `Button` variant="outline"
- Session 项 hover/active → Tailwind classes（删除 inline `onMouseEnter/Leave`）
- 重命名输入 → shadcn `Input`
- 删除/重命名按钮 → shadcn `Button` variant="ghost" size="icon"
- 删除确认 → shadcn `AlertDialog`

- [ ] **Step 2: 消息区域 — AI Elements 替换**

关键改动：
- 用户消息气泡 → `<Message from="user"><MessageContent><MessageResponse>`
- 助手消息气泡 → `<Message from="assistant"><MessageContent><MessageResponse>`
- 工具调用气泡保持自定义（AI Elements 可能没有对应组件），用 `Card` 包装
- 保留手写 MarkdownContent 渲染器，样式换成 Tailwind tokens

- [ ] **Step 3: 输入区域重构**

关键改动：
- 文本输入 → shadcn `Textarea`
- 发送按钮 → shadcn `Button` size="icon"
- 模型选择器 → shadcn `Select` + `SelectTrigger` + `SelectContent` + `SelectItem`
- 快捷提问按钮 → shadcn `Button` variant="outline" size="sm"

- [ ] **Step 4: 清理 inline styles**

全文搜索 `style={{`，确保所有 inline styles 已替换为 Tailwind classes。

- [ ] **Step 5: 验证 + 提交**

```bash
npx tsc --noEmit 2>&1 | grep "^src/"
git add src/components/panels/ChatPanel.tsx
git commit -m "refactor: ChatPanel — AI Elements + shadcn 全面替换"
```

---

## Task 11: 最终验证

- [ ] **Step 1: 全量构建**

```bash
npm run build 2>&1 | tail -20
```

Expected: 构建成功

- [ ] **Step 2: 浏览器端到端检查**

启动 dev server，逐页检查：
- 账号总览：卡片、告警标签、品类列表
- Chat：消息气泡、工具调用、模型选择、session 管理
- 品类视图 > KPI/告警/广告/库存：表格、状态标签、过滤按钮
- 右侧 Context 面板：文件卡片、新鲜度标签、上传

- [ ] **Step 3: grep 确认无残留 inline styles**

```bash
grep -r 'style={{' src/components/ --include="*.tsx" | grep -v node_modules | wc -l
```

Expected: 0（或极少量有合理理由的）

- [ ] **Step 4: 提交 + 推送**

```bash
git push
```
