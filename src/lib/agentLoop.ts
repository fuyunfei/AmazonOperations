/**
 * lib/agentLoop.ts
 *
 * Agent 流式对话循环（基于 Anthropic SDK，采用 Agent SDK 架构模式）
 *
 * 流式模式（对应 Agent SDK includePartialMessages: true）：
 *   - for await 迭代原始 SSE 事件（对应 StreamEvent）
 *   - content_block_delta + text_delta → 实时推送 text_delta
 *   - 流结束后处理 tool_use（对应 Agent SDK 工具调用轮次）
 *   - 最多循环 MAX_TURNS 轮直到 end_turn（对应 Agent SDK maxTurns）
 *
 * SSE 事件格式（推送给前端，对应 Agent SDK 输出事件）：
 *   { type: "session_start", sessionId }         ← 会话启动
 *   { type: "text_delta",   delta }              ← StreamEvent: content_block_delta / text_delta
 *   { type: "tool_start",   tool, input }        ← 工具调用开始
 *   { type: "tool_done",    tool, resultSummary }← 工具调用完成
 *   { type: "done",         messageId }          ← 对应 ResultMessage
 *   { type: "error",        message }            ← 错误
 *
 * 参考文档:
 *   https://code.claude.com/docs/en/agent-sdk/streaming-output
 *   https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode
 */

import Anthropic from "@anthropic-ai/sdk"
import { executeTool } from "./skills/index"

// 最大工具调用轮次（对应 Agent SDK maxTurns）
const MAX_TURNS = 10

// ── 类型定义 ───────────────────────────────────────────────────────────────

export interface ToolCallRecord {
  tool:          string
  input:         Record<string, unknown>
  resultSummary: string
}

export interface AgentLoopResult {
  role:      "assistant"
  content:   string
  toolCalls: ToolCallRecord[]
}

// ── 内部工具函数 ───────────────────────────────────────────────────────────

/** 将工具返回结果转为可读摘要（用于 UI 显示）*/
function buildResultSummary(result: string): string {
  try {
    const obj = JSON.parse(result)
    if (obj.error) return `错误: ${obj.error}`
    if (Array.isArray(obj)) return `返回 ${obj.length} 条记录`
    if (obj.rows   && Array.isArray(obj.rows))   return `返回 ${obj.rows.length} 条记录（共 ${obj.total ?? obj.rows.length} 条）`
    if (obj.alerts && Array.isArray(obj.alerts)) return `发现 ${obj.alerts.length} 条告警`
    const s = JSON.stringify(obj)
    return s.length > 200 ? s.slice(0, 200) + "…" : s
  } catch {
    return result.slice(0, 200)
  }
}

// ── Agent Loop ─────────────────────────────────────────────────────────────

/**
 * 运行 Agent 流式对话循环。
 *
 * @param sessionId    当前会话 ID
 * @param messages     已构建的对话历史（含本轮用户消息）
 * @param systemPrompt 系统提示词（含技能索引）
 * @param skillTools   本次可用工具（对应 Agent SDK allowedTools）
 * @param onEvent      SSE 事件推送回调
 */
export async function runAgentLoop(
  sessionId:    string,
  messages:     Anthropic.MessageParam[],
  systemPrompt: string,
  skillTools:   Anthropic.Tool[],
  onEvent:      (event: object) => void
): Promise<AgentLoopResult> {
  const client    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  let   history   = [...messages]
  const toolCalls: ToolCallRecord[] = []
  let   fullText  = ""

  for (let turn = 0; turn < MAX_TURNS; turn++) {

    // ── 开启流式请求 ──────────────────────────────────────────────────────
    const stream = client.messages.stream({
      model:      process.env.NEXT_PUBLIC_DEFAULT_MODEL ?? "claude-sonnet-4-6",
      max_tokens: 8192,
      system:     systemPrompt,
      tools:      skillTools.length > 0 ? skillTools : undefined,
      messages:   history,
    })

    // ── for await 迭代原始 SSE 事件（对应 Agent SDK StreamEvent）──────────
    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        fullText += event.delta.text
        onEvent({ type: "text_delta", delta: event.delta.text })
      }
    }

    // 流结束后取完整消息（对应 AssistantMessage）
    const finalMsg = await stream.finalMessage()

    // ── tool_use 轮次（工具调用）────────────────────────────────────────
    if (finalMsg.stop_reason === "tool_use") {
      const toolUseBlocks = (finalMsg.content as Anthropic.ContentBlock[]).filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      )

      // 将 assistant 轮次追加到历史
      history.push({ role: "assistant", content: finalMsg.content })
      fullText = "" // 工具调用轮次的中间文字不是最终回答，重置

      // 并行执行所有工具调用
      const toolResults = await Promise.all(
        toolUseBlocks.map(async (block: Anthropic.ToolUseBlock) => {
          onEvent({ type: "tool_start", tool: block.name, input: block.input })

          const result        = await executeTool(block.name, block.input as Record<string, unknown>)
          const resultSummary = buildResultSummary(result)

          onEvent({ type: "tool_done", tool: block.name, resultSummary })
          toolCalls.push({
            tool:          block.name,
            input:         block.input as Record<string, unknown>,
            resultSummary,
          })

          return {
            type:        "tool_result" as const,
            tool_use_id: block.id,
            content:     result,
          }
        })
      )

      // 将工具结果追加到历史，进入下一轮
      history.push({ role: "user", content: toolResults })
      continue
    }

    // ── end_turn：最终回答 ────────────────────────────────────────────────
    if (finalMsg.stop_reason === "end_turn") {
      return { role: "assistant", content: fullText, toolCalls }
    }

    // 其他 stop_reason（max_tokens 等）直接返回已累积内容
    return { role: "assistant", content: fullText, toolCalls }
  }

  throw new Error(`超过最大对话轮次（${MAX_TURNS} 轮）`)
}
