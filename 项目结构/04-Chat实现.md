# 04 — Chat 实现

[← 返回索引](./index.md)

> 对应功能设计：`功能数据流/06-Chat功能.md`

---

## 架构概述

Chat 升级为 **多 Session + 标准 Claude Agent SDK** 架构：

```
前端 ChatPanel（两栏布局）
  左栏：Session 列表 + 新建对话
  右栏：当前 Session 消息历史 + 工具调用气泡 + 输入框
    │
    │  Session CRUD → /api/sessions/*
    │  发送消息     → POST /api/sessions/:id/run  （SSE 流式）
    ▼

/api/sessions/:id/run
  │
  ├── 从 DB 加载 Session 历史（最近 20 轮）
  ├── buildAgentSystemPrompt()  构建 System Prompt（每次发消息重新调用，感知新上传文件）
  │
  └── runAgentLoop()
        ├── SDK stream() 发起流式请求
        │     └── on('text')  → SSE: text_delta
        │
        ├── stream 结束 → finalMessage.stop_reason === "tool_use"
        │     ├── 提取 content[] 中的 tool_use 块
        │     ├── SSE: tool_start（含 tool 名 + input）
        │     ├── executeTool() → DB 查询 → JSON 字符串
        │     ├── SSE: tool_done（含 resultSummary）
        │     └── 追加 tool_result → 再次 stream()（agent loop 代码控制）
        │
        └── stop_reason === "end_turn"
              ├── SSE: done（含 messageId）
              └── 完整消息写入 DB（user + assistant + toolCalls[]）
```

---

## 一、Session 管理 API

```
POST   /api/sessions              创建 Session，写入 DB，返回 { id, title, createdAt }
GET    /api/sessions              返回所有 Session 列表（按 updatedAt 倒序）
GET    /api/sessions/:id          返回指定 Session + 最近 20 轮消息历史
PATCH  /api/sessions/:id          更新 Session 标题（重命名）
DELETE /api/sessions/:id          删除 Session（及其所有消息）
POST   /api/sessions/:id/run      执行 Agent Loop，SSE 流式响应
```

---

## 二、SSE 事件规范

服务端通过 SSE 向前端推送 Agent 执行过程：

| type | 含义 | 额外字段 |
|------|------|---------|
| `session_start` | Agent 开始执行 | `sessionId` |
| `tool_start` | 开始执行工具 | `tool: string`, `input: object` |
| `tool_done` | 工具执行完毕 | `tool: string`, `resultSummary: string` |
| `text_delta` | 流式文字片段 | `delta: string` |
| `done` | 本轮回答结束 | `messageId: string` |
| `error` | 出错 | `message: string`, `code?: string` |

---

## 三、Agent Loop 实现

```ts
// lib/agentLoop.ts

const MAX_ITERATIONS = 10

async function runAgentLoop(
  sessionId:    string,
  messages:     Anthropic.MessageParam[],   // 从 DB 加载的历史
  systemPrompt: string,
  skillTools:   Anthropic.Tool[],           // 本 Session 挂载的 Skill 工具集
  onEvent:      (event: object) => void
): Promise<{ role: "assistant"; content: string; toolCalls: ToolCallRecord[] }> {
  const client   = new Anthropic()
  let history    = [...messages]
  let toolCalls: ToolCallRecord[] = []

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    // 每轮使用 stream()，流式阶段只处理 text 事件
    const stream = client.messages.stream({
      model:      "claude-sonnet-4-6",
      max_tokens: 4096,
      system:     systemPrompt,
      tools:      skillTools,
      messages:   history,
    })

    // 流式阶段：text_delta 实时推送
    stream.on("text", (text) => {
      onEvent({ type: "text_delta", delta: text })
    })

    // 等待流结束，取最终消息
    const finalMsg = await stream.finalMessage()

    // 情况1：stop_reason = tool_use（流结束后处理，非中途）
    if (finalMsg.stop_reason === "tool_use") {
      const toolUseBlocks = finalMsg.content.filter(b => b.type === "tool_use")
      history.push({ role: "assistant", content: finalMsg.content })

      const toolResults = await Promise.all(
        toolUseBlocks.map(async (block) => {
          onEvent({ type: "tool_start", tool: block.name, input: block.input })
          const result        = await executeTool(block.name, block.input)
          const resultSummary = buildResultSummary(block.name, result)
          onEvent({ type: "tool_done", tool: block.name, resultSummary })

          // 记录工具调用（持久化用）
          toolCalls.push({ tool: block.name, input: block.input, result: resultSummary })

          return {
            type:        "tool_result" as const,
            tool_use_id: block.id,
            content:     result,
          }
        })
      )

      history.push({ role: "user", content: toolResults })
      continue   // agent loop 代码驱动下一轮
    }

    // 情况2：stop_reason = end_turn（最终文字回答）
    if (finalMsg.stop_reason === "end_turn") {
      const textContent = finalMsg.content
        .filter(b => b.type === "text")
        .map(b => b.text)
        .join("")
      return { role: "assistant", content: textContent, toolCalls }
    }
  }

  throw new Error(`超过最大工具调用次数（${MAX_ITERATIONS}次）`)
}
```

---

## 四、Session 执行端点

```ts
// app/api/sessions/[id]/run/route.ts

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { userMessage } = await req.json()
  const sessionId = params.id

  const stream  = new TransformStream()
  const writer  = stream.writable.getWriter()
  const encoder = new TextEncoder()
  const send    = (data: object) =>
    writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))

  ;(async () => {
    try {
      send({ type: "session_start", sessionId })

      // 1. 从 DB 加载历史（最近 20 轮 user+assistant 对）
      const dbMessages = await db.message.findMany({
        where:   { sessionId },
        orderBy: { createdAt: "asc" },
        take:    40,   // 20对 × 2
      })
      const history = buildApiMessages(dbMessages)

      // 追加本轮用户消息
      const userMsg: Anthropic.MessageParam = { role: "user", content: userMessage }
      history.push(userMsg)

      // 2. 构建 System Prompt（每次重新拉取，感知新上传文件）
      const systemPrompt = await buildAgentSystemPrompt()

      // 3. 获取本 Session 挂载的 Skill 工具集（默认 Amazon Ops Skill）
      const skillTools = await getSessionSkillTools(sessionId)

      // 4. 执行 Agent Loop
      const result = await runAgentLoop(sessionId, history, systemPrompt, skillTools, send)

      // 5. 持久化：写入 user + assistant 消息
      const [savedUser, savedAssistant] = await Promise.all([
        db.message.create({ data: { sessionId, role: "user",      content: userMessage } }),
        db.message.create({ data: { sessionId, role: "assistant", content: result.content, toolCalls: result.toolCalls } }),
      ])
      await db.session.update({ where: { id: sessionId }, data: { updatedAt: new Date() } })

      // 若是第一条消息，用消息前 30 字更新 Session 标题
      const msgCount = await db.message.count({ where: { sessionId } })
      if (msgCount <= 2) {
        await db.session.update({
          where: { id: sessionId },
          data:  { title: userMessage.slice(0, 30) },
        })
      }

      send({ type: "done", messageId: savedAssistant.id })
    } catch (e) {
      send({ type: "error", message: String(e) })
    } finally {
      await writer.close()
    }
  })()

  return new Response(stream.readable, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection":    "keep-alive",
    },
  })
}
```

---

## 五、Skill 系统

Skill 是工具集的封装单元，每个 Session 挂载的工具集通过 Skill 注册表读取：

```ts
// lib/skills/index.ts

interface Skill {
  id:          string
  name:        string
  description: string
  tools:       Anthropic.Tool[]
  executor:    Record<string, (input: any) => Promise<string>>
}

// 内置 Skill：Amazon Ops（默认挂载到所有新建 Session）
export const amazonOpsSkill: Skill = {
  id:          "amazon-ops",
  name:        "Amazon 运营工具集",
  description: "查询已上传报表数据，支持 KPI、广告活动、搜索词、库存、告警等分析",
  tools:       TOOL_DEFINITIONS,      // 复用 agentTools.ts 中的 8 个工具定义
  executor:    { get_metrics: ..., get_search_terms: ..., /* 其余 6 个 */ },
}

// 执行工具时通过 Skill executor 路由
export async function executeTool(name: string, input: any): Promise<string> {
  const skill = registeredSkills.find(s => s.executor[name])
  if (!skill) return JSON.stringify({ error: `未知工具: ${name}` })
  return skill.executor[name](input)
}

// 获取某 Session 挂载的所有工具定义（合并多个 Skill）
export async function getSessionSkillTools(sessionId: string): Promise<Anthropic.Tool[]> {
  // MVP：所有 Session 默认挂载 amazonOpsSkill
  return amazonOpsSkill.tools
}
```

**8 个内置工具**（同旧版，打包进 Amazon Ops Skill）：

| 工具 | 用途 |
|------|------|
| `get_metrics(time_window)` | 查询 KPI 快照 |
| `get_acos_history(asin, days?)` | 查询 ACoS 日趋势 |
| `get_inventory()` | 查询库存状况 |
| `get_ad_campaigns(filter)` | 查询广告活动 |
| `get_search_terms(filter)` | 查询搜索词转化 |
| `get_alerts(level, category?)` | 查询已触发告警 |
| `list_uploaded_files()` | 列出已上传文件 |
| `get_file_data(file_type, limit?)` | 读取原始文件数据 |

工具执行实现（`executeTool` 内部逻辑）见旧版 `04-Chat实现.md` 第四节，逻辑不变。

---

## 六、System Prompt 构建

每次用户发送消息时，服务端重新调用 `buildAgentSystemPrompt()` 构建（自动感知新上传文件）：

```ts
// lib/buildSystemPrompt.ts （结构不变，内容同旧版）

export async function buildAgentSystemPrompt(): Promise<string> {
  const files        = await db.contextFile.findMany()
  const fileList     = files.map(f => `- ${f.fileType}: ${f.fileName}（${f.snapshotDate}）`).join("\n")
  const toolRules    = buildToolRulesText()    // 工具强制映射规则
  const benchmarks   = buildBenchmarkText()    // 各品类 KPI 阈值
  const sopSummary   = SOP_SUMMARY_TEXT        // SOP P0–P3 规则摘要

  return `你是 YZ-Ops AI，亚马逊运营数据分析助手。\n\n## 已上传文件\n${fileList}\n\n${toolRules}\n\n## KPI 健康基准\n${benchmarks}\n\n## 广告优化 SOP\n${sopSummary}\n\n## 边界限制\n- 只基于已上传数据分析，不做销量预测\n- 不直接执行广告后台操作\n- 若数据不存在，明确告知缺少哪份报表`.trim()
}
```

---

## 七、前端 ChatPanel 核心逻辑

```ts
// components/panels/ChatPanel.tsx（核心片段）

// 切换 Session：从 DB 加载历史
async function selectSession(sessionId: string) {
  setActiveSessionId(sessionId)
  const data = await fetch(`/api/sessions/${sessionId}`).then(r => r.json())
  setMessages(data.messages)   // [{ role, content, toolCalls[] }]
}

// 发送消息
async function sendMessage(userText: string) {
  const tempUserMsg = { role: "user", content: userText }
  setMessages(prev => [...prev, tempUserMsg])
  setStreaming(true)

  const response = await fetch(`/api/sessions/${activeSessionId}/run`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ userMessage: userText }),
  })

  const reader  = response.body!.getReader()
  const decoder = new TextDecoder()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    for (const line of decoder.decode(value).split("\n")) {
      if (!line.startsWith("data: ")) continue
      const event = JSON.parse(line.slice(6))

      if (event.type === "text_delta") {
        // 追加流式文字到正在渲染的气泡
        setStreamingText(prev => prev + event.delta)
      }
      if (event.type === "tool_start") {
        // 添加 loading 状态的工具调用气泡
        setToolBubbles(prev => [...prev, { tool: event.tool, input: event.input, status: "loading" }])
      }
      if (event.type === "tool_done") {
        // 更新对应气泡为 done 状态
        setToolBubbles(prev => prev.map(b =>
          b.tool === event.tool && b.status === "loading"
            ? { ...b, status: "done", resultSummary: event.resultSummary }
            : b
        ))
      }
      if (event.type === "done") {
        // 将流式文字固化为消息，刷新 Session 列表
        setMessages(prev => [...prev, { role: "assistant", content: streamingText }])
        setStreamingText("")
        setToolBubbles([])
        setStreaming(false)
        refreshSessions()   // 更新 Session updatedAt / 标题
      }
    }
  }
}
```

---

## 八、消息历史策略

```
DB 存储
  Session 表    id / title / createdAt / updatedAt
  Message 表    id / sessionId / role / content / toolCalls[] / createdAt

加载规则
  GET /api/sessions/:id → 取最近 40 条（= 最近 20 轮 user+assistant 对）
  超长 Session：历史自动截断，保留 System Prompt + 最近 20 轮（防 context 超限）

工具调用记录
  toolCalls[] 存摘要（tool 名 + input + resultSummary），不存完整 JSON 返回
  用于 UI 展示工具调用历史，不用于重建 API 消息数组
```

| 项目 | 策略 | 原因 |
|------|------|------|
| 前端消息历史 | 切换 Session 时从 DB 加载，无需重建 | 多 Session 切换需要真实持久化 |
| 服务端 history | 每轮请求从 DB 拉取 + 本轮消息，循环内追加 tool_use/tool_result | Anthropic API 多轮工具调用格式要求 |
| 跨轮数据 | Claude 每轮重新调工具获取最新数据 | 数据可能因新报表上传而变化 |
| 持久化 | user + assistant 消息在 `done` 事件后写入 DB | 刷新页面后可继续对话 |
| 最大轮次 | agent loop 代码控制 max_iterations = 10 | 防止死循环；SDK 本身无此参数 |
