/**
 * lib/skills/index.ts
 *
 * Skill 注册表 + 路由函数
 *
 * getSessionSkillTools(sessionId) → Anthropic.Tool[]
 * executeTool(name, input)        → Promise<string>
 */

import type Anthropic from "@anthropic-ai/sdk"
import { amazonOpsSkill, type Skill } from "./amazonOps"

// 已注册的 Skill 列表（MVP：仅内置 Amazon Ops Skill）
const registeredSkills: Skill[] = [amazonOpsSkill]

/**
 * 获取某 Session 挂载的所有工具定义（合并多个 Skill）。
 * MVP：所有 Session 默认挂载 amazonOpsSkill，不查 DB。
 */
export async function getSessionSkillTools(
  _sessionId: string
): Promise<Anthropic.Tool[]> {
  // MVP：所有 Session 默认挂载 amazonOpsSkill
  return amazonOpsSkill.tools
}

/**
 * 按工具名路由到对应 Skill 的 executor。
 */
export async function executeTool(
  name:  string,
  input: Record<string, unknown>
): Promise<string> {
  for (const skill of registeredSkills) {
    if (skill.executor[name]) {
      return skill.executor[name](input)
    }
  }
  return JSON.stringify({ error: `未知工具: ${name}` })
}
