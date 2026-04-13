/**
 * POST /api/sessions/:id/run
 *
 * Agent Loop 入口，SSE 流式输出。
 * body: { userMessage: string }
 *
 * SSE 事件流：
 *   session_start → text_delta* → tool_start/tool_done* → done
 *   （出错时发 error 事件）
 */

import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { buildAgentSystemPrompt } from "@/lib/buildSystemPrompt"
import { getSessionSkillTools, getSkillIndex } from "@/lib/skills/index"
import { runAgentLoop } from "@/lib/agentLoop"
import type Anthropic from "@anthropic-ai/sdk"

/** 从 DB Message[] 重建 Anthropic API messages 数组（仅含 user/assistant 文字轮次） */
function buildApiMessages(
  dbMessages: Array<{ role: string; content: string }>
): Anthropic.MessageParam[] {
  return dbMessages
    .filter(m => m.content.trim() !== "")
    .map(m => ({
      role:    m.role as "user" | "assistant",
      content: m.content,
    }))
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userMessage } = await req.json() as { userMessage: string }
  const sessionId = params.id

  const stream  = new TransformStream()
  const writer  = stream.writable.getWriter()
  const encoder = new TextEncoder()

  const send = (data: object) => {
    writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
  }

  // 异步执行 agent loop（不阻塞 SSE 响应返回）
  ;(async () => {
    try {
      send({ type: "session_start", sessionId })

      // 1. 从 DB 加载历史（最近 40 条 = 最近 20 轮 user+assistant 对）
      const dbMessages = await db.message.findMany({
        where:   { sessionId },
        orderBy: { createdAt: "asc" },
        take:    40,
      })
      const history = buildApiMessages(dbMessages)

      // 追加本轮用户消息
      history.push({ role: "user", content: userMessage })

      // 2. 构建 System Prompt（每次重新拉取，感知新上传文件）
      //    注入技能索引（对应 Agent SDK settingSources: ["project"]）
      const [basePrompt, skillIndex] = await Promise.all([
        buildAgentSystemPrompt(),
        Promise.resolve(getSkillIndex()),
      ])
      const systemPrompt = skillIndex
        ? `${basePrompt}\n\n${skillIndex}`
        : basePrompt

      // 3. 获取本 Session 挂载的 Skill 工具集（对应 Agent SDK allowedTools）
      const skillTools = await getSessionSkillTools(sessionId)

      // 4. 执行 Agent Loop
      const result = await runAgentLoop(sessionId, history, systemPrompt, skillTools, send)

      // 5. 持久化：写入 user + assistant 消息
      const [, savedAssistant] = await Promise.all([
        db.message.create({
          data: { sessionId, role: "user", content: userMessage },
        }),
        db.message.create({
          data: {
            sessionId,
            role:      "assistant",
            content:   result.content,
            toolCalls: result.toolCalls.length > 0
              ? JSON.stringify(result.toolCalls)
              : null,
          },
        }),
      ])

      // 更新 Session.updatedAt
      await db.session.update({
        where: { id: sessionId },
        data:  { updatedAt: new Date() },
      })

      // 若是第一条消息，用消息前 30 字更新 Session 标题
      const msgCount = await db.message.count({ where: { sessionId } })
      if (msgCount <= 2) {
        await db.session.update({
          where: { id: sessionId },
          data:  { title: userMessage.slice(0, 30) },
        })
      }

      send({ type: "done", messageId: savedAssistant.id })
    } catch (err) {
      send({ type: "error", message: String(err) })
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
