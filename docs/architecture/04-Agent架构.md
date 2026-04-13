# 04 — Agent 架构

[← 返回索引](../README.md)

> 对应功能设计：[features/06-Chat.md](../features/06-Chat.md)  
> **当前实现**：基于 `@anthropic-ai/sdk` v0.36.3 的 `messages.stream()` + 手写 Agent Loop。**不是** Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)。

---

## 架构概述

```
前端 ChatPanel（两栏布局）
    │
    │  Session CRUD → /api/sessions/*
    │  发送消息     → POST /api/sessions/:id/run  （SSE 流式）
    ▼

/api/sessions/:id/run/route.ts
    │
    ├── 1. 从 DB 加载 Session 历史（最近 20 轮）
    ├── 2. buildAgentSystemPrompt()  动态构建 System Prompt
    ├── 3. getSessionSkillTools()    获取工具定义
    └── 4. runAgentLoop()            执行 Agent 循环
          │
          ├── stream.on('text') → SSE: text_delta（逐 token）
          │
          ├── stop_reason = "tool_use"
          │     ├── SSE: tool_start
          │     ├── executeTool() → DB 查询 → JSON
          │     ├── SSE: tool_done
          │     └── 追加 tool_result → 继续循环
          │
          └── stop_reason = "end_turn"
                ├── SSE: done
                └── 消息写入 DB
```

---

## 一、Agent Loop（`lib/agentLoop.ts`）

手写循环，最多 10 轮迭代：

```ts
for (let i = 0; i < MAX_ITERATIONS; i++) {
  const stream = client.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: systemPrompt,
    tools: skillTools,
    messages: history,
  })

  // 流式推送 text_delta
  stream.on("text", (text) => onEvent({ type: "text_delta", delta: text }))

  const finalMsg = await stream.finalMessage()

  if (finalMsg.stop_reason === "tool_use") {
    // 提取 tool_use blocks → 并行执行 → 追加 tool_result → continue
  }
  if (finalMsg.stop_reason === "end_turn") {
    return { content: fullText, toolCalls }
  }
}
```

关键设计：
- **工具在流结束后执行**，不是流中途。`finalMessage()` 返回后才提取 `tool_use` blocks
- 多个工具调用用 `Promise.all` 并行执行
- 工具调用轮次的文字会被**重置**（`fullText = ""`），只保留最终回答
- 工具结果以 `{ role: "user", content: [tool_result...] }` 追加到 history

---

## 二、Skill 系统（`lib/skills/`）

两层封装：Skill 接口 + 注册表路由。

### Skill 接口

```ts
interface Skill {
  id:          string
  name:        string
  description: string
  tools:       Anthropic.Tool[]                                        // 工具定义
  executor:    Record<string, (input: Record<string, unknown>) => Promise<string>>  // 工具执行
}
```

### 注册表（`skills/index.ts`）

```ts
const registeredSkills: Skill[] = [amazonOpsSkill]  // MVP 仅一个

// 路由：按工具名找到对应 Skill 的 executor
async function executeTool(name, input) {
  for (const skill of registeredSkills) {
    if (skill.executor[name]) return skill.executor[name](input)
  }
}

// MVP：所有 Session 固定挂载 amazonOpsSkill
async function getSessionSkillTools(sessionId) {
  return amazonOpsSkill.tools
}
```

### 内置 Amazon Ops Skill（`skills/amazonOps.ts`）

将 `agentTools.ts` 的 8 个工具定义 + 执行函数包装为一个 Skill 对象，默认挂载到所有 Session。

设计为可扩展多 Skill，但当前是硬编码单 skill。

---

## 三、工具实现（`lib/agentTools.ts`）

所有工具都是 **DB 查询 → JSON 字符串**：

| 工具 | 数据源 | 查询方式 |
|------|--------|----------|
| `get_metrics` | `ProductMetricDay` | 按日期范围聚合，计算衍生指标 |
| `get_acos_history` | `ProductMetricDay` | 按 ASIN + 日期取时序 |
| `get_inventory` | `ContextFile(inventory)` | 直接读 parsedRows |
| `get_ad_campaigns` | `ContextFile(campaign_3m)` | 读 JSON + 内存过滤 |
| `get_search_terms` | `ContextFile(search_terms)` | 读 JSON + 内存过滤 |
| `get_alerts` | `Alert` 表 | 取最新 snapshotDate |
| `list_uploaded_files` | `ContextFile` | 全量 + 新鲜度计算 |
| `get_file_data` | `ContextFile(any)` | 通用读取，支持 limit |

工具结果通过 `buildResultSummary()` 生成摘要（如"返回 5 条记录"），用于前端气泡展示。

---

## 四、System Prompt 构建（`lib/buildSystemPrompt.ts`）

每次用户发送消息时**动态重建**，包含：

| 部分 | 内容 | 来源 |
|------|------|------|
| 已上传文件列表 | fileType + fileName + snapshotDate | DB: ContextFile |
| 工具使用规则 | 文件类型 → 工具强制映射 | 硬编码 |
| KPI 健康基准 | 各品类 ACoS/CTR/CVR 基准值 | `config.ts` |
| SOP 规则摘要 | P0-P3 广告优化规则概要 | 硬编码 + config |
| 边界限制 | 不做预测、不执行后台操作 | 硬编码 |

---

## 五、Session 管理 API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/sessions` | POST | 创建 Session |
| `/api/sessions` | GET | 列出所有 Session（按 updatedAt 倒序） |
| `/api/sessions/:id` | GET | 取 Session + 最近 40 条消息（20 轮） |
| `/api/sessions/:id` | PATCH | 重命名 |
| `/api/sessions/:id` | DELETE | 删除（级联删消息） |
| `/api/sessions/:id/run` | POST | 执行 Agent Loop，SSE 流式响应 |

### 执行端点流程（`/api/sessions/:id/run`）

1. 从 DB 加载最近 40 条消息，转为 `Anthropic.MessageParam[]`（仅 role + content 文字，不含 tool blocks）
2. 追加本轮用户消息
3. `buildAgentSystemPrompt()` 动态构建 system prompt
4. `getSessionSkillTools()` 获取工具定义
5. `runAgentLoop()` 执行循环，通过 SSE 回调推送事件
6. 持久化 user + assistant 消息到 DB
7. 首条消息自动设置 Session 标题（前 30 字）

---

## 六、SSE 事件规范

| type | 含义 | 额外字段 |
|------|------|---------|
| `session_start` | Agent 开始执行 | `sessionId` |
| `text_delta` | 流式文字片段 | `delta: string` |
| `tool_start` | 开始执行工具 | `tool: string`, `input: object` |
| `tool_done` | 工具执行完毕 | `tool: string`, `resultSummary: string` |
| `done` | 本轮回答结束 | `messageId: string` |
| `error` | 出错 | `message: string` |

---

## 七、消息持久化策略

| 项目 | 策略 |
|------|------|
| 存储 | user + assistant 消息在 `done` 后写入 DB |
| 工具调用记录 | 存摘要（tool + input + resultSummary），不存完整返回 JSON |
| 历史加载 | 取最近 40 条（20 轮），超长自动截断 |
| API 消息格式 | 仅传 role + content 文字，不含 tool blocks |
| 跨轮数据 | Claude 每轮重新调工具获取最新数据 |

---

## 八、关键文件

| 文件 | 职责 |
|------|------|
| `src/lib/agentLoop.ts` | Agent 循环（stream + tool dispatch） |
| `src/lib/agentTools.ts` | 8 个工具定义 + DB 查询执行 |
| `src/lib/skills/index.ts` | Skill 注册表 + executeTool 路由 |
| `src/lib/skills/amazonOps.ts` | 内置 Amazon Ops Skill |
| `src/lib/buildSystemPrompt.ts` | 动态 System Prompt 构建 |
| `src/app/api/sessions/[id]/run/route.ts` | SSE 流式 API 入口 |
| `src/components/panels/ChatPanel.tsx` | 前端两栏布局 + SSE 消费 |

---

## 九、已知限制与演进方向

当前架构的局限：
- **消息历史不完整**：API 消息数组只传纯文字，丢失 tool_use/tool_result 中间轮次，影响多轮追问质量
- **Skill 固定挂载**：所有 Session 共用同一 Skill，无法按 Session 定制工具集
- **轮次硬编码**：`MAX_ITERATIONS = 10`，无动态控制

迁移计划见 [plans/agent-sdk-migration.md](../plans/agent-sdk-migration.md)。
