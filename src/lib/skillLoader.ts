/**
 * lib/skillLoader.ts
 *
 * Agent SDK Skills 文件系统加载器
 *
 * 从 .claude/skills/<name>/SKILL.md 加载技能定义，
 * 对应 Agent SDK 的 settingSources: ["project"] 配置。
 *
 * 参考: https://code.claude.com/docs/en/agent-sdk/skills
 */

import fs from "fs"
import path from "path"

// ── 类型定义 ───────────────────────────────────────────────────────────────

export interface SkillMetadata {
  /** 技能唯一标识（YAML frontmatter: name）*/
  name: string
  /** 技能描述，Claude 根据此描述判断是否调用（YAML frontmatter: description）*/
  description: string
  /** 本技能提供的工具名列表（YAML frontmatter: tools）*/
  tools?: string[]
}

export interface LoadedSkill {
  /** 技能目录名（即 .claude/skills/<id>/）*/
  id: string
  /** YAML frontmatter 解析结果 */
  metadata: SkillMetadata
  /** SKILL.md 正文（不含 frontmatter）*/
  body: string
  /** SKILL.md 全文（含 frontmatter，用于注入 context）*/
  raw: string
}

// ── YAML frontmatter 解析 ──────────────────────────────────────────────────

/**
 * 解析 SKILL.md 的 YAML frontmatter。
 * 只处理简单的 key: value 和 key:\n  - item 列表，不依赖外部库。
 */
function parseFrontmatter(raw: string): { metadata: SkillMetadata; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) {
    return { metadata: { name: "unknown", description: "" }, body: raw }
  }

  const yamlStr = match[1]
  const body    = match[2].trim()
  const metadata: SkillMetadata = { name: "unknown", description: "" }

  // 解析 key: value 行
  const lines = yamlStr.split("\n")
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const colonIdx = line.indexOf(":")
    if (colonIdx === -1) { i++; continue }

    const key   = line.slice(0, colonIdx).trim()
    const value = line.slice(colonIdx + 1).trim()

    if (key === "name") {
      metadata.name = value
    } else if (key === "description") {
      metadata.description = value
    } else if (key === "tools" && value === "") {
      // 解析 tools 列表（- item 格式）
      const tools: string[] = []
      i++
      while (i < lines.length && lines[i].trimStart().startsWith("-")) {
        tools.push(lines[i].trim().replace(/^-\s*/, ""))
        i++
      }
      metadata.tools = tools
      continue
    }
    i++
  }

  return { metadata, body }
}

// ── 技能加载 ───────────────────────────────────────────────────────────────

/**
 * 从项目根目录 .claude/skills/ 加载所有技能（对应 settingSources: ["project"]）。
 * 每个子目录中必须有 SKILL.md 文件。
 */
export function loadProjectSkills(): LoadedSkill[] {
  const skillsRoot = path.join(process.cwd(), ".claude", "skills")
  if (!fs.existsSync(skillsRoot)) return []

  const skills: LoadedSkill[] = []

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(skillsRoot, { withFileTypes: true })
  } catch {
    return []
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const skillMdPath = path.join(skillsRoot, entry.name, "SKILL.md")
    if (!fs.existsSync(skillMdPath)) continue

    try {
      const raw = fs.readFileSync(skillMdPath, "utf-8")
      const { metadata, body } = parseFrontmatter(raw)
      skills.push({ id: entry.name, metadata, body, raw })
    } catch (err) {
      console.warn(`[skillLoader] 无法加载 ${skillMdPath}:`, err)
    }
  }

  return skills
}

/**
 * 将所有技能的描述汇总为字符串，用于注入 system prompt 中的技能索引。
 * 对应 Agent SDK 技能发现机制（Claude 根据 description 决定调用哪个技能）。
 */
export function buildSkillIndex(skills: LoadedSkill[]): string {
  if (skills.length === 0) return ""

  const lines = ["## 可用技能（Skills）", ""]
  for (const skill of skills) {
    lines.push(`### ${skill.metadata.name}`)
    lines.push(skill.metadata.description)
    if (skill.metadata.tools?.length) {
      lines.push(`工具: ${skill.metadata.tools.join(", ")}`)
    }
    lines.push("")
  }
  return lines.join("\n").trimEnd()
}
