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

export interface AsinScatterItem {
  asin: string
  gmv: number
  acos: number
  adSpend: number
}

function getAcosColor(acos: number): string {
  if (acos < 0.35) return "#22c55e"
  if (acos < 0.55) return "#f59e0b"
  return "#ef4444"
}

const chartConfig = {
  gmv: { label: "GMV ($)", color: "#2563eb" },
  acos: { label: "ACoS (%)", color: "#06b6d4" },
  adSpend: { label: "广告花费 ($)", color: "#8b5cf6" },
} satisfies ChartConfig

export function AsinScatterChart({ data }: { data: AsinScatterItem[] }) {
  // Transform acos to percentage for display
  const chartData = useMemo(
    () =>
      data.map((d) => ({
        ...d,
        acosPercent: +(d.acos * 100).toFixed(1),
      })),
    [data]
  )

  const legendItems = [
    { label: "ACoS <35%", color: "#22c55e" },
    { label: "ACoS 35-55%", color: "#f59e0b" },
    { label: "ACoS >55%", color: "#ef4444" },
  ]

  if (data.length === 0) return null

  return (
    <Card className="mb-6">
      <CardContent className="pt-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-medium text-foreground">
              ASIN 效率散点图
            </p>
            <p className="text-xs text-muted-foreground">
              X=GMV, Y=ACoS(%), 气泡大小=广告花费
            </p>
          </div>
          {/* Legend */}
          <div className="flex items-center gap-3">
            {legendItems.map((item) => (
              <div key={item.label} className="flex items-center gap-1">
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

        <ChartContainer config={chartConfig} className="h-64 w-full">
          <ScatterChart
            margin={{ top: 10, right: 20, left: 10, bottom: 10 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              className="stroke-border"
            />
            <XAxis
              type="number"
              dataKey="gmv"
              name="GMV ($)"
              tick={{ fontSize: 11 }}
              tickFormatter={(v: number) =>
                v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`
              }
            >
              <Label
                value="GMV ($)"
                position="insideBottom"
                offset={-5}
                className="text-xs fill-muted-foreground"
              />
            </XAxis>
            <YAxis
              type="number"
              dataKey="acosPercent"
              name="ACoS (%)"
              tick={{ fontSize: 11 }}
              unit="%"
              domain={[0, "auto"]}
            >
              <Label
                value="ACoS (%)"
                angle={-90}
                position="insideLeft"
                offset={5}
                className="text-xs fill-muted-foreground"
              />
            </YAxis>
            <ZAxis
              type="number"
              dataKey="adSpend"
              range={[60, 400]}
              name="广告花费 ($)"
            />

            {/* Target ACoS reference line at 35% */}
            <ReferenceLine
              y={35}
              stroke="#22c55e"
              strokeDasharray="5 5"
              label={{
                value: "目标 ACoS 35%",
                position: "insideTopRight",
                fontSize: 10,
                fill: "#22c55e",
              }}
            />

            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value, name) => {
                    if (name === "GMV ($)")
                      return `$${Number(value).toLocaleString()}`
                    if (name === "ACoS (%)")
                      return `${value}%`
                    if (name === "广告花费 ($)")
                      return `$${Number(value).toLocaleString()}`
                    return String(value)
                  }}
                  labelFormatter={(_label, payload) => {
                    const item = payload?.[0]?.payload as
                      | (AsinScatterItem & { acosPercent: number })
                      | undefined
                    return item ? item.asin : String(_label)
                  }}
                />
              }
            />

            <Scatter data={chartData} name="ASIN">
              {chartData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={getAcosColor(entry.acos)}
                  fillOpacity={0.75}
                  stroke={getAcosColor(entry.acos)}
                  strokeWidth={1}
                />
              ))}
            </Scatter>
          </ScatterChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
