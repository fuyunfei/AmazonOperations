"use client"

import { Line, LineChart, CartesianGrid, XAxis, YAxis, ReferenceLine } from "recharts"
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { Card, CardContent } from "@/components/ui/card"

interface TACoSPoint {
  date: string
  tacos: number
}

interface TACoSTrendChartProps {
  data: TACoSPoint[]
}

const chartConfig = {
  tacos: { label: "TACoS", color: "#f97316" },
} satisfies ChartConfig

export function TACoSTrendChart({ data }: TACoSTrendChartProps) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="mb-4">
          <p className="text-sm font-medium text-foreground">TACoS 趋势</p>
          <p className="text-xs text-muted-foreground">
            广告花费 / GMV（虚线为 20% 目标线）
          </p>
        </div>
        <ChartContainer config={chartConfig} className="h-56 w-full">
          <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={4}
              tickFormatter={(v: number) => `${v.toFixed(0)}%`}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value) => `${Number(value).toFixed(1)}%`}
                />
              }
            />
            <ReferenceLine
              y={20}
              stroke="#94a3b8"
              strokeDasharray="6 3"
              label={{ value: "目标 20%", position: "insideTopRight", fill: "#94a3b8", fontSize: 11 }}
            />
            <Line
              type="monotone"
              dataKey="tacos"
              stroke="var(--color-tacos)"
              strokeWidth={2}
              dot={{ r: 3, fill: "#f97316" }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
