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
import { runAgentLoop } from "@/lib/agentLoop"

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
      // 1. 查询 Session，获取 SDK session ID（如果有）
      const session = await db.session.findUnique({ where: { id: sessionId } })
      // sdkSessionId 暂存在 Session 表中（可选字段，后续可加）
      // MVP 阶段每次新建 SDK session，不做 resume
      const sdkSessionId = null

      // 2. 构建 System Prompt（每次重新拉取，感知新上传文件）
      const systemPrompt = await buildAgentSystemPrompt()

      // 3. 执行 Agent Loop（SDK 自动处理工具调用循环）
      const result = await runAgentLoop(
        sessionId,
        userMessage,
        systemPrompt,
        send,
        sdkSessionId,
      )

      // 4. 持久化：写入 user + assistant 消息
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
