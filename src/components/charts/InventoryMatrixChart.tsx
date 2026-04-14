"use client"

import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  ZAxis,
  Label,
  Cell,
} from "recharts"
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { Card, CardContent } from "@/components/ui/card"
import { useMemo } from "react"

export interface InventoryMatrixItem {
  asin: string
  label: string
  dailyAvg: number
  daysOfSupply: number
  sellableQty: number
  quadrant: "critical" | "warning" | "healthy" | "stale" | "observe"
}

const QUADRANT_COLORS: Record<string, string> = {
  critical: "#ef4444",
  warning: "#f59e0b",
  healthy: "#22c55e",
  stale: "#a855f7",
  observe: "#6b7280",
}

const QUADRANT_LABELS: Record<string, string> = {
  critical: "紧急补货",
  warning: "注意补货",
  healthy: "健康",
  stale: "滞销风险",
  observe: "观察",
}

const chartConfig = {
  dailyAvg: { label: "日均销量", color: "#2563eb" },
  daysOfSupply: { label: "库存天数", color: "#06b6d4" },
} satisfies ChartConfig

export function InventoryMatrixChart({
  data,
}: {
  data: InventoryMatrixItem[]
}) {
  const medianDailyAvg = useMemo(() => {
    const sorted = data.map((d) => d.dailyAvg).sort((a, b) => a - b)
    return sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 0
  }, [data])

  const legendItems = useMemo(() => {
    const present = new Set(data.map((d) => d.quadrant))
    return Array.from(present).map((q) => ({
      key: q,
      label: QUADRANT_LABELS[q] ?? q,
      color: QUADRANT_COLORS[q] ?? "#6b7280",
    }))
  }, [data])

  if (data.length === 0) return null

  return (
    <Card className="mb-6">
      <CardContent className="pt-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-medium text-foreground">
              库存健康矩阵
            </p>
            <p className="text-xs text-muted-foreground">
              X=日均销量, Y=库存天数, 颜色=健康状态
            </p>
          </div>
          {/* Legend */}
          <div className="flex items-center gap-3">
            {legendItems.map((item) => (
              <div key={item.key} className="flex items-center gap-1">
                <div
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: item.color }}
                />
                <span className="text-xs text-muted-foreground">
                  {item.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        <ChartContainer config={chartConfig} className="h-72 w-full">
          <ScatterChart
            margin={{ top: 10, right: 20, left: 10, bottom: 10 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              className="stroke-border"
            />
            <XAxis
              type="number"
              dataKey="dailyAvg"
              name="日均销量"
              tick={{ fontSize: 11 }}
              unit="件"
            >
              <Label
                value="日均销量"
                position="insideBottom"
                offset={-5}
                className="text-xs fill-muted-foreground"
              />
            </XAxis>
            <YAxis
              type="number"
              dataKey="daysOfSupply"
              name="库存天数"
              tick={{ fontSize: 11 }}
              unit="天"
              domain={[0, "auto"]}
            >
              <Label
                value="库存天数"
                angle={-90}
                position="insideLeft"
                offset={5}
                className="text-xs fill-muted-foreground"
              />
            </YAxis>
            <ZAxis
              type="number"
              dataKey="sellableQty"
              range={[60, 400]}
              name="可售数量"
            />

            {/* Reference lines */}
            <ReferenceLine
              y={45}
              stroke="#f59e0b"
              strokeDasharray="5 5"
              label={{
                value: "45天",
                position: "insideTopRight",
                fontSize: 10,
                fill: "#f59e0b",
              }}
            />
            {medianDailyAvg > 0 && (
              <ReferenceLine
                x={medianDailyAvg}
                stroke="#6b7280"
                strokeDasharray="5 5"
                label={{
                  value: `中位数 ${medianDailyAvg}`,
                  position: "insideTopRight",
                  fontSize: 10,
                  fill: "#6b7280",
                }}
              />
            )}

            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value, name, item) => {
                    const payload = item?.payload as
                      | InventoryMatrixItem
                      | undefined
                    if (!payload) return null
                    if (name === "日均销量")
                      return `${value} 件/天`
                    if (name === "库存天数")
                      return `${value} 天`
                    if (name === "可售数量")
                      return `${value} 件`
                    return String(value)
                  }}
                  labelFormatter={(_label, payload) => {
                    const item = payload?.[0]?.payload as
                      | InventoryMatrixItem
                      | undefined
                    return item
                      ? `${item.asin} (${item.label})`
                      : String(_label)
                  }}
                />
              }
            />

            <Scatter data={data} name="ASIN">
              {data.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={QUADRANT_COLORS[entry.quadrant] ?? "#6b7280"}
                  fillOpacity={0.75}
                  stroke={QUADRANT_COLORS[entry.quadrant] ?? "#6b7280"}
                  strokeWidth={1}
                />
              ))}
            </Scatter>
          </ScatterChart>
        </ChartContainer>

        {/* Quadrant explanation */}
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>高速+低库存 = 紧急补货</span>
          <span>高速+高库存 = 健康</span>
          <span>低速+高库存 = 滞销风险</span>
          <span>低速+低库存 = 观察</span>
        </div>
      </CardContent>
    </Card>
  )
}
