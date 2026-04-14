"use client"

import { useMemo } from "react"
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  ReferenceLine,
  Tooltip,
} from "recharts"
import {
  type ChartConfig,
  ChartContainer,
} from "@/components/ui/chart"
import { Card, CardContent } from "@/components/ui/card"

interface ScatterPoint {
  term: string
  clicks: number
  cvr: number
  acos: number | null
  spend: number
  orders: number
}

interface SearchScatterChartProps {
  data: ScatterPoint[]
}

const CLICK_THRESHOLD = 20
const CVR_THRESHOLD = 3

const chartConfig = {
  winners: { label: "高效词 (高点击+高CVR)", color: "#16a34a" },
  moneyPits: { label: "烧钱词 (高点击+低CVR)", color: "#dc2626" },
  potential: { label: "潜力词 (低点击+高CVR)", color: "#2563eb" },
  low: { label: "低量词", color: "#9ca3af" },
} satisfies ChartConfig

function getQuadrant(clicks: number, cvr: number): keyof typeof chartConfig {
  if (clicks >= CLICK_THRESHOLD && cvr >= CVR_THRESHOLD) return "winners"
  if (clicks >= CLICK_THRESHOLD && cvr < CVR_THRESHOLD) return "moneyPits"
  if (clicks < CLICK_THRESHOLD && cvr >= CVR_THRESHOLD) return "potential"
  return "low"
}

function getColor(quadrant: keyof typeof chartConfig): string {
  const colors: Record<keyof typeof chartConfig, string> = {
    winners: "#16a34a",
    moneyPits: "#dc2626",
    potential: "#2563eb",
    low: "#9ca3af",
  }
  return colors[quadrant]
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload: ScatterPoint & { quadrant: string } }>
}) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="rounded-lg border border-border/50 bg-background px-3 py-2 text-xs shadow-xl">
      <p className="font-medium text-foreground mb-1">{d.term}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-muted-foreground">
        <span>点击</span>
        <span className="font-mono text-foreground">{d.clicks}</span>
        <span>CVR</span>
        <span className="font-mono text-foreground">{d.cvr.toFixed(1)}%</span>
        <span>花费</span>
        <span className="font-mono text-foreground">${d.spend.toFixed(2)}</span>
        <span>订单</span>
        <span className="font-mono text-foreground">{d.orders}</span>
      </div>
    </div>
  )
}

export function SearchScatterChart({ data }: SearchScatterChartProps) {
  const grouped = useMemo(() => {
    const groups: Record<string, Array<ScatterPoint & { quadrant: string }>> = {
      winners: [],
      moneyPits: [],
      potential: [],
      low: [],
    }
    for (const point of data) {
      const q = getQuadrant(point.clicks, point.cvr)
      groups[q].push({ ...point, quadrant: q })
    }
    return groups
  }, [data])

  const maxSpend = useMemo(
    () => Math.max(...data.map((d) => d.spend), 1),
    [data]
  )

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="mb-4">
          <p className="text-sm font-medium text-foreground">搜索词效率散点图</p>
          <p className="text-xs text-muted-foreground">
            X=点击量, Y=CVR(%), 气泡大小=花费
          </p>
        </div>

        {/* Quadrant legend */}
        <div className="flex flex-wrap gap-3 mb-3">
          {(
            [
              { key: "winners", label: "高效词", color: "#16a34a" },
              { key: "moneyPits", label: "烧钱词", color: "#dc2626" },
              { key: "potential", label: "潜力词", color: "#2563eb" },
              { key: "low", label: "低量词", color: "#9ca3af" },
            ] as const
          ).map((q) => (
            <div key={q.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <div
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: q.color }}
              />
              <span>
                {q.label} ({grouped[q.key]?.length ?? 0})
              </span>
            </div>
          ))}
        </div>

        <ChartContainer config={chartConfig} className="h-72 w-full">
          <ScatterChart margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid />
            <XAxis
              type="number"
              dataKey="clicks"
              name="点击"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
            />
            <YAxis
              type="number"
              dataKey="cvr"
              name="CVR"
              tickLine={false}
              axisLine={false}
              tickMargin={4}
              tickFormatter={(v: number) => `${v}%`}
            />
            <ZAxis
              type="number"
              dataKey="spend"
              range={[30, 300]}
              domain={[0, maxSpend]}
            />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine
              x={CLICK_THRESHOLD}
              stroke="#94a3b8"
              strokeDasharray="4 4"
            />
            <ReferenceLine
              y={CVR_THRESHOLD}
              stroke="#94a3b8"
              strokeDasharray="4 4"
            />
            {(["winners", "moneyPits", "potential", "low"] as const).map(
              (q) =>
                grouped[q].length > 0 && (
                  <Scatter
                    key={q}
                    name={chartConfig[q].label}
                    data={grouped[q]}
                    fill={getColor(q)}
                    fillOpacity={0.7}
                  />
                )
            )}
          </ScatterChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
