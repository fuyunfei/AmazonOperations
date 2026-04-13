# Chat 模块重构方案：迁移到 Claude Agent SDK

> **状态说明**（2026-04）：
> - **方案 A（流式升级）**：✅ 已完成。`agentLoop.ts` 已改用 `messages.stream()`，支持逐 token 流式输出。
> - **方案 B（完整迁移 Agent SDK）**：❌ 未开始。需新建 MCP Server + 替换 agent loop。
> - 以下"现状分析"中的问题 1（无 token 流式）已不再存在。

## 1. 现状分析

### 1.1 当前技术栈

```
@anthropic-ai/sdk  →  client.messages.stream()  →  手写 for loop  →  executeTool()
```

涉及文件：

| 文件 | 职责 |
|---|---|
| `src/lib/agentLoop.ts` | 手写 agentic loop（for × 10 轮） |
| `src/lib/agentTools.ts` | 工具定义（6 个工具）+ 服务端工具执行 |
| `src/app/api/agent/route.ts` | SSE 流式路由，调 agentLoop |
| `src/components/panels/ChatPanel.tsx` | 前端消息管理，重建历史，解析 SSE |

### 1.2 当前实现的核心问题

#### 问题 1：无 token 级流式输出

```ts
// 现在：非流式，等整个回复生成完才推送
const response = await client.messages.create({ ... })
// 循环结束后一次性推所有文字
for (const block of response.content) {
  await onEvent({ type: "text_delta", delta: block.text })
}
```

效果：用户看到的是「打字动画」但实际是整段文字一次性出现，**延迟感强**。

#### 问题 2：前端重建对话历史（脆弱）

```ts
// ChatPanel.tsx：只传 user/assistant 纯文字，丢失 tool_use/tool_result 轮次
const history = messages
  .filter(m => m.content !== "")
  .map(m => ({ role: m.role, content: m.content }))
```

问题：工具调用的中间轮次（`tool_use` block、`tool_result` block）被丢弃，**多轮对话时 Claude 丧失工具执行上下文**，影响连续追问的质量。

#### 问题 3：人工限制轮次上限

```ts
const MAX_ITERATIONS = 10
for (let i = 0; i < MAX_ITERATIONS; i++) { ... }
throw new Error(`超过最大工具调用次数（10次）`)
```

硬编码上限，复杂问题被截断，无动态控制机制。

#### 问题 4：工具与 loop 紧耦合

`agentLoop.ts` 直接引用 `agentTools.ts`，扩展新工具必须同时修改两个文件；工具实现无法复用于其他接入方（CLI、测试等）。

---

## 2. Claude Agent SDK 是什么

**包名：** `@anthropic-ai/claude-agent-sdk`（非现有的 `@anthropic-ai/sdk`）

```ts
import { query } from "@anthropic-ai/claude-agent-sdk"

for await (const message of query({
  prompt: "分析本周广告效率",
  options: { model: "claude-sonnet-4-6", maxTurns: 20 }
})) {
  if (message.type === "result") console.log(message.result)
}
```

核心特性：

| 特性 | 说明 |
|---|---|
| 内置 agentic loop | SDK 自动处理 tool_use / tool_result 循环，无需手写 for loop |
| session 持久化 | 对话历史自动写入磁盘，`continue: true` 即可续接 |
| token 级流式 | `includePartialMessages: true` 逐 token 推送 |
| MCP 工具接入 | 自定义工具通过 MCP server 接入，不需要在 loop 内手动 dispatch |
| 取消控制 | `query.interrupt()` 或 `AbortController` |

**关键区别（vs 当前实现）：**

```
当前：you implement the tool loop
                 ↓
SDK：Claude handles tools autonomously
```

---

## 3. 适配性分析

### 3.1 哪些东西可以直接获益

| 当前问题 | SDK 解法 |
|---|---|
| 无 token 流式 | `includePartialMessages: true` → `SDKPartialAssistantMessage` |
| 手写 for loop | `query()` 内置 loop，`maxTurns` 动态控制 |
| 历史重建脆弱 | `continue: true` / `resume: sessionId` 持久化会话 |
| 轮次硬截断 | `result.subtype === "error_max_turns"` 可优雅处理 |

### 3.2 需要额外工作的地方

**核心问题：当前 6 个自定义工具直接查 SQLite DB，而 Agent SDK 的自定义工具须通过 MCP server 暴露。**

```
现在：agentTools.ts → db.productMetricDay.findMany() 直接查询
需要：SQLite DB → MCP Server（stdio/HTTP）→ Agent SDK → Claude
```

需要新建的 MCP server 包含以下工具：

```
mcp__yz-ops__get_metrics
mcp__yz-ops__get_acos_history
mcp__yz-ops__get_alerts
mcp__yz-ops__get_context_file
mcp__yz-ops__get_inventory
mcp__yz-ops__get_asin_config
```

### 3.3 架构层面的注意事项

Agent SDK **在内部 spawn 子进程**（运行 Claude Code CLI），这与当前完全在进程内的 Messages API 调用有显著差异：

| 维度 | 当前（Messages API） | Agent SDK |
|---|---|---|
| 运行方式 | Next.js API 进程内直接调用 | spawn 子进程（node/bun/deno） |
| 并发开销 | 低（仅 HTTP 请求） | 高（每次对话一个子进程） |
| session 存储 | 无（每次前端重建历史） | 磁盘（`~/.claude/projects/`） |
| 多用户隔离 | 天然隔离（无状态） | 需要 per-user session 管理 |

> 对于低并发内部工具（如本项目 MVP），子进程开销可接受。若面向大量并发用户，需评估。

---

## 4. 重构方案

### 方案 A：渐进式——先解决流式，保留现有架构（低风险）

**改动范围：** 仅修改 `agentLoop.ts`，其他文件不动。

核心变化：把 `messages.create()` 换成 `messages.stream()`（仍在 `@anthropic-ai/sdk` 包内）：

```ts
// agentLoop.ts — 改动后
const stream = client.messages.stream({
  model, max_tokens: 4096,
  system: systemPrompt, tools: TOOL_DEFINITIONS, messages: history,
})

// 逐 token 推送
stream.on("text", async (text) => {
  await onEvent({ type: "text_delta", delta: text })
})

const response = await stream.finalMessage()
// 后续 tool_use 处理逻辑不变
```

**收益：** 真正的逐 token 流式，用户体验立竿见影  
**局限：** 不解决历史重建和 session 持久化问题

---

### 方案 B：完整迁移到 Claude Agent SDK（推荐长期方向）

#### 步骤一：新建 MCP Server

新文件：`src/mcp/yz-ops-server.ts`

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { db } from "../lib/db"

const server = new McpServer({ name: "yz-ops", version: "1.0.0" })

server.tool("get_metrics", { time_window: z.enum(["today","w7","w14","d30"]), asin: z.string().optional() },
  async ({ time_window, asin }) => {
    // 现有 agentTools.ts 中 get_metrics 的逻辑迁移至此
    const rows = await db.productMetricDay.findMany({ ... })
    return { content: [{ type: "text", text: JSON.stringify(rows) }] }
  }
)
// ... 其余 5 个工具同理

const transport = new StdioServerTransport()
await server.connect(transport)
```

打包为独立可执行脚本（`scripts/mcp-server.ts`），通过 `ts-node` 启动。

#### 步骤二：重写 `/api/agent/route.ts`

```ts
import { query } from "@anthropic-ai/claude-agent-sdk"

export async function POST(req: NextRequest) {
  const { prompt, sessionId, model } = await req.json()

  const stream = new TransformStream()
  const writer = stream.writable.getWriter()
  const send = async (data: object) =>
    writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))

  ;(async () => {
    const queryObj = query({
      prompt,
      options: {
        model,
        maxTurns: 20,
        systemPrompt: await buildSystemPrompt(),
        includePartialMessages: true,       // token 级流式
        persistSession: true,               // 会话持久化
        ...(sessionId ? { resume: sessionId } : {}),
        mcpServers: {
          "yz-ops": {
            command: "ts-node",
            args: ["scripts/mcp-server.ts"],
          }
        },
        allowedTools: ["mcp__yz-ops__*"],
      }
    })

    for await (const msg of queryObj) {
      // token 流式
      if (msg.type === "assistant" && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === "text") await send({ type: "text_delta", delta: block.text })
          if (block.type === "tool_use") await send({ type: "tool_start", tool: block.name })
        }
      }
      // 工具结果（用于 tool_done 提示）
      if (msg.type === "user") await send({ type: "tool_done" })
      // 完成，返回 sessionId 供前端保存
      if (msg.type === "result") {
        await send({ type: "done", sessionId: msg.session_id, cost: msg.total_cost_usd })
      }
    }
    await writer.close()
  })()

  return new Response(stream.readable, { headers: SSE_HEADERS })
}
```

#### 步骤三：前端 ChatPanel.tsx 变更

| 变更点 | 内容 |
|---|---|
| 移除历史重建逻辑 | 不再手动 map messages → history，只传当前 prompt |
| 保存 sessionId | 首轮 `done` 事件返回 `sessionId`，存入 `useState` |
| 后续轮次带 sessionId | 每次发送携带 `sessionId`，服务端 `resume` 续接 |
| 取消按钮 | 调用 `queryObj.interrupt()` 或前端 `AbortController` |

核心状态变化：

```ts
// 新增
const [sessionId, setSessionId] = useState<string | null>(null)

// done 事件处理
if (event.type === "done" && event.sessionId) {
  setSessionId(event.sessionId)
}

// 发送时
body: JSON.stringify({ prompt: userText, sessionId, model: selectedModel })
```

---

## 5. 对比总结

| 维度 | 现在 | 方案 A（流式升级） | 方案 B（完整迁移） |
|---|---|---|---|
| token 流式 | ✗ | ✅ | ✅ |
| 多轮历史完整 | ✗ 重建 | ✗ 重建 | ✅ SDK session |
| 工具扩展性 | 改两个文件 | 改两个文件 | MCP server 独立扩展 |
| 实现复杂度 | 已完成 | 低 | 高（需 MCP server） |
| 依赖变化 | 无 | 无 | 新增 `@anthropic-ai/claude-agent-sdk` + `@modelcontextprotocol/sdk` |
| 并发性能 | 高（进程内） | 高（进程内） | 中（子进程） |

---

## 6. 建议执行顺序

```
阶段 1（本周）：方案 A
  └─ 修改 agentLoop.ts → messages.stream()
  └─ 效果：Chat 逐 token 显示，改动 < 30 行

阶段 2（下一 sprint）：方案 B 第一步
  └─ 新建 MCP server，迁移 6 个工具
  └─ 并行测试两套 tool 路径

阶段 3：完成方案 B
  └─ 路由换 query()，前端保存 sessionId
  └─ 删除 agentLoop.ts / agentTools.ts
```
