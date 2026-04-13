/**
 * lib/skills/amazonOps.ts
 *
 * 内置 Amazon Ops Skill — 封装 8 个工具定义 + 执行器
 * 默认挂载到所有新建 Session
 */

import type Anthropic from "@anthropic-ai/sdk"
import { TOOL_DEFINITIONS, executeTool as executeAgentTool } from "@/lib/agentTools"

export interface Skill {
  id:          string
  name:        string
  description: string
  tools:       Anthropic.Tool[]
  executor:    Record<string, (input: Record<string, unknown>) => Promise<string>>
}

export const amazonOpsSkill: Skill = {
  id:          "amazon-ops",
  name:        "Amazon 运营工具集",
  description: "查询已上传报表数据，支持 KPI、广告活动、搜索词、库存、告警等分析",
  tools:       TOOL_DEFINITIONS,
  executor:    Object.fromEntries(
    TOOL_DEFINITIONS.map(t => [
      t.name,
      (input: Record<string, unknown>) => executeAgentTool(t.name, input),
    ])
  ),
}
