/**
 * 解析：系统-Nordhive-多站点-关键词监控
 *
 * 格式特殊：
 *   - 与其他 Nordhive 文件不同，无 Total 汇总行
 *   - Row1(idx 0)：筛选条件标签
 *   - Row2(idx 1)：筛选条件值（D2 = "All"，非日期范围）
 *   - Row3(idx 2)：空行
 *   - Row4(idx 3)：列头
 *   - Row5(idx 4)+：数据行（直接从 idx 4 开始，无 Total）
 *
 * snapshotDate 从文件名中提取（格式：keyword_YYYY-MM-DD.xlsx 或含8位数字）
 */

import {
  readWorkbook,
  sheetToRows,
  toNum,
  toInt,
  fuzzyGet,
} from "./utils"

export interface KeywordMonitorRow {
  asin:         string
  keyword:      string
  marketplace:  string
  naturalRank:  number   // 自然排名，0 = 未排名
  spRank:       number   // SP 广告排名，0 = 未投放
  overallRank:  number   // 综合排名，0 = 未上榜
  rating:       number   // 评分（如 4.5）
  reviewCount:  number   // 评论数
  bsrMain:      number   // BSR 主类排名
  bsrSub:       number   // BSR 子类排名
  updatedAt:    string   // 报表内更新时间（字符串）
}

/**
 * 从字符串中提取前导整数（如 "4390 ホーム＆キッチン" → 4390，"27↓（2）" → 27，"--" → 0）
 */
function extractLeadingInt(v: unknown): number {
  const s = String(v ?? "").trim()
  const m = s.match(/^(\d+)/)
  return m ? parseInt(m[1], 10) : 0
}

export function parseKeywordMonitor(buffer: Buffer, filename = ""): KeywordMonitorRow[] {
  const wb  = readWorkbook(buffer)
  const ws  = wb.Sheets[wb.SheetNames[0]]
  const raw = sheetToRows(ws)

  // 列头在 idx 3（Row4），数据从 idx 4 开始（无 Total 行）
  const headers = (raw[3] ?? []).map(h => String(h ?? "").trim())

  const rows: KeywordMonitorRow[] = []

  for (let i = 4; i < raw.length; i++) {
    const row = raw[i]
    if (!row || row.every(c => c === null || c === "")) continue

    // 组装对象
    const obj: Record<string, unknown> = {}
    headers.forEach((h, j) => { if (h) obj[h] = row[j] ?? null })

    const asin = String(fuzzyGet(obj, ["ASIN", "asin"]) ?? "").trim()
    if (!asin) continue

    rows.push({
      asin,
      keyword:     String(fuzzyGet(obj, ["关键词", "keyword", "Keyword"]) ?? "").trim(),
      marketplace: String(fuzzyGet(obj, ["站点", "marketplace", "Marketplace"]) ?? "").trim().toUpperCase(),
      naturalRank: extractLeadingInt(fuzzyGet(obj, ["自然排名", "natural_rank", "自然"])),
      spRank:      extractLeadingInt(fuzzyGet(obj, ["SP排名", "sp_rank", "SP"])),
      overallRank: extractLeadingInt(fuzzyGet(obj, ["综合排名", "overall_rank", "综合"])),
      rating:      toNum(fuzzyGet(obj, ["评分", "rating", "Rating"])),
      reviewCount: toInt(fuzzyGet(obj, ["评论数", "review_count", "评论"])),
      bsrMain:     extractLeadingInt(fuzzyGet(obj, ["BSR主类", "bsr_main", "BSR大类", "主类BSR"])),
      bsrSub:      extractLeadingInt(fuzzyGet(obj, ["BSR子类", "bsr_sub", "BSR小类", "子类BSR"])),
      updatedAt:   String(fuzzyGet(obj, ["更新时间", "updated_at", "更新日期"]) ?? "").trim(),
    })
  }

  return rows
}

/**
 * 从文件名中提取 snapshotDate（YYYY-MM-DD）。
 * 优先匹配 YYYY-MM-DD 格式，其次匹配 YYYYMMDD 8位数字。
 */
export function extractSnapshotDateFromFilename(filename: string): string {
  // 尝试 YYYY-MM-DD
  const m1 = filename.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (m1) return `${m1[1]}-${m1[2]}-${m1[3]}`
  // 尝试 YYYYMMDD
  const m2 = filename.match(/(\d{4})(\d{2})(\d{2})/)
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`
  // 兜底：今日
  return new Date().toISOString().slice(0, 10)
}
