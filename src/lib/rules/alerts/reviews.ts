/**
 * lib/rules/alerts/reviews.ts
 *
 * 评分告警规则（来自关键词监控报表）
 *   rating < 3.8 → 红色告警
 *   rating < 4.0 → 黄色警告
 *   BSR 排名仅供 Chat 查询，不触发告警
 */

import type { AlertCandidate } from "./types"
import { getParam } from "@/lib/config"

export function checkRating(
  rating:       number,
  asin:         string,
  categoryKey:  string,
  stage:        string,
  snapshotDate: string
): AlertCandidate | null {
  if (rating <= 0) return null  // 无评分数据，跳过

  const redThreshold    = getParam("rating_red")
  const yellowThreshold = getParam("rating_yellow")

  if (rating < redThreshold) {
    return {
      asin,
      categoryKey,
      metric:       "rating",
      level:        "red",
      currentValue: rating,
      threshold:    redThreshold,
      stage,
      suggestion:   `评分 ${rating.toFixed(1)} 低于 ${redThreshold} 红线，立即排查差评根因，考虑 Vine / 跟进差评`,
      snapshotDate,
    }
  }

  if (rating < yellowThreshold) {
    return {
      asin,
      categoryKey,
      metric:       "rating",
      level:        "yellow",
      currentValue: rating,
      threshold:    yellowThreshold,
      stage,
      suggestion:   `评分 ${rating.toFixed(1)} 低于 ${yellowThreshold} 警戒线，关注差评趋势并回复`,
      snapshotDate,
    }
  }

  return null
}
