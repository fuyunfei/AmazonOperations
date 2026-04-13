/**
 * lib/skills/index.ts
 *
 * Skill 注册表 + 路由函数
 *
 * 支持两种技能来源（对应 Agent SDK settingSources）：
 * 1. 项目技能（settingSources: "project"）：
 *    从 .claude/skills/<name>/SKILL.md 加载——自动发现，无需代码注册
 * 2. 代码技能（内置）：
 *    amazonOpsSkill — 含工具定义（Anthropic.Tool[]）+ 执行器（DB 查询）
 *
 * 未来新增技能只需：
 *   a) 在 .claude/skills/ 新建目录 + SKILL.md（技能文档）
 *   b) 在此文件 registeredSkills 追加技能实现（工具定义 + 执行器）
 *
 * 导出：
 *   getSessionSkillTools(sessionId) → Anthropic.Tool[]    对应 Agent SDK allowedTools
 *   executeTool(name, input)        → Promise<string>     工具执行路由
 *   getSkillIndex()                 → string              技能描述索引（注入 system prompt）
 */

import type Anthropic from "@anthropic-ai/sdk"
import { amazonOpsSkill, type Skill } from "./amazonOps"
import { loadProjectSkills, buildSkillIndex } from "@/lib/skillLoader"

// ── 已注册的代码技能（含工具定义 + 执行器）──────────────────────────────────
// 新增技能时在此数组追加
const registeredSkills: Skill[] = [
  amazonOpsSkill,
  // future: reportingSkill, forecastingSkill, ...
]

// ── 公共 API ───────────────────────────────────────────────────────────────

/**
 * 获取某 Session 可用的所有工具定义（对应 Agent SDK allowedTools）。
 * 当前：所有 Session 默认挂载全部已注册技能的工具集。
 * 未来可根据 sessionId 或用户配置动态选择技能子集。
 */
export async function getSessionSkillTools(
  _sessionId: string
): Promise<Anthropic.Tool[]> {
  // 合并所有已注册技能的工具定义
  return registeredSkills.flatMap(skill => skill.tools)
}

/**
 * 按工具名路由到对应 Skill 的执行器。
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

/**
 * 构建技能索引字符串，用于注入 system prompt。
 * 从 .claude/skills/ 读取所有 SKILL.md，提取 name + description。
 * 对应 Agent SDK 的技能发现机制（Claude 根据描述判断调用哪个技能）。
 */
export function getSkillIndex(): string {
  const fileSkills = loadProjectSkills()
  return buildSkillIndex(fileSkills)
}
