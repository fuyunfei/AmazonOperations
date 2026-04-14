"use client"

import { Card, CardContent } from "@/components/ui/card"

const FUNNEL_COLORS = ["#3b82f6", "#6366f1", "#8b5cf6", "#a855f7"]
const ASIN_COLORS = ["#06b6d4", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#ec4899"]

export interface FunnelData {
  stage: string
  value: number
  rate: number | null
}

export interface AsinFunnel {
  asin: string
  impressions: number
  clicks: number
  ad_orders: number
  orders: number
}

/* ---------- Benchmarks ---------- */

const BENCHMARKS: Record<string, number> = {
  "曝光→点击": 0.03,
  "点击→广告订单": 0.05,
}

/* ---------- Helpers ---------- */

function getAsinValue(asin: AsinFunnel, stage: string): number {
  switch (stage) {
    case "曝光": return asin.impressions
    case "点击": return asin.clicks
    case "广告订单": return asin.ad_orders
    case "总订单": return asin.orders
    default: return 0
  }
}

function generateFunnelInsight(data: FunnelData[], byAsin?: AsinFunnel[]): string {
  const ctr = data[1]?.rate
  const cvr = data[2]?.rate
  if (ctr != null && ctr < 0.03)
    return `⚠️ 点击率 ${(ctr * 100).toFixed(1)}% 低于基准 3%，建议检查主图和标题竞争力`
  if (cvr != null && cvr < 0.05)
    return `⚠️ 转化率 ${(cvr * 100).toFixed(1)}% 低于基准 5%，建议检查价格、评分和详情页`

  // Check per-ASIN imbalance
  if (byAsin && byAsin.length > 1) {
    const topAsin = byAsin[0]
    const totalImpressions = byAsin.reduce((s, a) => s + a.impressions, 0)
    const topShare = totalImpressions > 0 ? topAsin.impressions / totalImpressions : 0
    if (topShare > 0.7)
      return `⚠️ ASIN ...${topAsin.asin.slice(-5)} 占曝光 ${(topShare * 100).toFixed(0)}%，流量集中度过高`
  }

  return `✅ 转化链路健康：CTR ${((ctr ?? 0) * 100).toFixed(1)}%，CVR ${((cvr ?? 0) * 100).toFixed(1)}%`
}

/* ---------- Component ---------- */

export function AdFunnelChart({
  data,
  byAsin,
  title,
}: {
  data: FunnelData[]
  byAsin?: AsinFunnel[]
  title?: string
}) {
  const maxValue = data[0]?.value || 1

  return (
    <Card>
      <CardContent className="pt-4">
        {title && (
          <div className="mb-4">
            <p className="text-sm font-medium text-foreground">{title}</p>
            <p className="text-xs text-muted-foreground">曝光 → 点击 → 广告订单 → 总订单</p>
          </div>
        )}

        {/* Funnel bars with per-ASIN segments */}
        <div className="space-y-3">
          {data.map((item, idx) => {
            const widthPct = Math.max((item.value / maxValue) * 100, 8)
            return (
              <div key={item.stage}>
                {/* Main bar row */}
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-16 text-right shrink-0">
                    {item.stage}
                  </span>
                  <div className="flex-1 relative">
                    <div
                      className="h-8 rounded-md flex items-center px-3 transition-all"
                      style={{ width: `${widthPct}%`, backgroundColor: FUNNEL_COLORS[idx] }}
                    >
                      <span className="text-xs font-semibold text-white whitespace-nowrap">
                        {item.value.toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground w-14 shrink-0">
                    {item.rate != null ? `${(item.rate * 100).toFixed(1)}%` : ""}
                  </span>
                </div>

                {/* Per-ASIN mini bars underneath */}
                {byAsin && byAsin.length > 0 && (
                  <div className="flex gap-1 ml-20 mt-1">
                    {byAsin.map((asin, i) => {
                      const asinValue = getAsinValue(asin, item.stage)
                      const asinPct = Math.max((asinValue / (item.value || 1)) * 100, 5)
                      return (
                        <div
                          key={asin.asin}
                          className="flex items-center gap-1"
                          title={`${asin.asin}: ${asinValue.toLocaleString()}`}
                        >
                          <div
                            className="h-3 rounded-sm"
                            style={{
                              width: `${asinPct * 2}px`,
                              backgroundColor: ASIN_COLORS[i % ASIN_COLORS.length],
                            }}
                          />
                          <span className="text-[9px] text-muted-foreground">
                            {asin.asin.slice(-5)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Conversion rate annotations with benchmark coloring */}
        <div className="mt-4 flex justify-around text-center">
          {data.slice(1).map((item, idx) => {
            const transitionLabel = `${data[idx].stage}→${item.stage}`
            const benchmark = BENCHMARKS[transitionLabel]
            const rateValue = item.rate ?? 0
            const aboveBenchmark = benchmark != null ? rateValue >= benchmark : null

            return (
              <div key={item.stage}>
                <p
                  className={`text-lg font-bold font-mono ${
                    aboveBenchmark === true
                      ? "text-emerald-600"
                      : aboveBenchmark === false
                        ? "text-destructive"
                        : "text-foreground"
                  }`}
                >
                  {item.rate != null ? `${(item.rate * 100).toFixed(2)}%` : "—"}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {transitionLabel}
                </p>
                {benchmark != null && (
                  <p className="text-[9px] text-muted-foreground">
                    基准 {(benchmark * 100).toFixed(0)}%
                  </p>
                )}
              </div>
            )
          })}
        </div>

        {/* Auto-insight */}
        <p className="mt-4 text-xs text-muted-foreground border-t border-border pt-3">
          {generateFunnelInsight(data, byAsin)}
        </p>
      </CardContent>
    </Card>
  )
}
