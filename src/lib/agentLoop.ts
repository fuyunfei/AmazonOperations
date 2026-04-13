/**
 * lib/agentLoop.ts
 *
 * 基于 Claude Agent SDK stream() 的工具调用循环。
 *
 * 流式阶段：on("text") 实时推送 text_delta
 * 流结束后：检查 stop_reason 处理工具调用（非中途中断）
 *
 * onEvent 回调格式（SSE 事件）：
 *   { type: "session_start", sessionId: string }
 *   { type: "text_delta",   delta: string }
 *   { type: "tool_start",   tool: string, input: object }
 *   { type: "tool_done",    tool: string, resultSummary: string }
 *   { type: "done",         messageId: string }
 *   { type: "error",        message: string }
 */

import Anthropic from "@anthropic-ai/sdk"
import { executeTool } from "./skills/index"

const MAX_ITERATIONS = 10

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

/**
 * 构建工具结果摘要（截断过长的 JSON 输出）
 */
function buildResultSummary(toolName: string, result: string): string {
  try {
    const obj = JSON.parse(result)
    if (obj.error) return `错误: ${obj.error}`
    // 若是数组，汇报行数
    if (Array.isArray(obj)) return `返回 ${obj.length} 条记录`
    if (obj.rows && Array.isArray(obj.rows)) return `返回 ${obj.rows.length} 条记录（共 ${obj.total ?? obj.rows.length} 条）`
    if (obj.alerts && Array.isArray(obj.alerts)) return `发现 ${obj.alerts.length} 条告警`
    // 通用截断
    const s = JSON.stringify(obj)
    return s.length > 200 ? s.slice(0, 200) + "…" : s
  } catch {
    return result.slice(0, 200)
  }
}

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

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    // 每轮使用 stream()，流式阶段实时推送 text_delta
    const stream = client.messages.stream({
      model:      "claude-sonnet-4-6",
      max_tokens: 4096,
      system:     systemPrompt,
      tools:      skillTools,
      messages:   history,
    })

    // 流式阶段：text_delta 实时推送
    stream.on("text", (text) => {
      fullText += text
      onEvent({ type: "text_delta", delta: text })
    })

    // 等待流结束，取最终消息
    const finalMsg = await stream.finalMessage()

    // ── stop_reason = tool_use（流结束后处理，非中途）────────────────────────
    if (finalMsg.stop_reason === "tool_use") {
      const toolUseBlocks = finalMsg.content.filter(
        (b: Anthropic.ContentBlock): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      )
      history.push({ role: "assistant", content: finalMsg.content })
      fullText = "" // 工具调用轮次的文字不是最终回答，重置

      const toolResults = await Promise.all(
        toolUseBlocks.map(async (block: Anthropic.ToolUseBlock) => {
          onEvent({ type: "tool_start", tool: block.name, input: block.input })
          const result        = await executeTool(block.name, block.input as Record<string, unknown>)
          const resultSummary = buildResultSummary(block.name, result)
          onEvent({ type: "tool_done", tool: block.name, resultSummary })

          toolCalls.push({ tool: block.name, input: block.input as Record<string, unknown>, resultSummary })

          return {
            type:        "tool_result" as const,
            tool_use_id: block.id,
            content:     result,
          }
        })
      )

      history.push({ role: "user", content: toolResults })
      continue
    }

    // ── stop_reason = end_turn（最终文字回答）────────────────────────────────
    if (finalMsg.stop_reason === "end_turn") {
      // fullText 已通过 stream.on("text") 累积
      return { role: "assistant", content: fullText, toolCalls }
    }
  }

  throw new Error(`超过最大工具调用次数（${MAX_ITERATIONS}次）`)
}
