"use client"

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart"
import { Card, CardContent } from "@/components/ui/card"

interface CategoryMeta {
  key: string
  label: string
}

interface CategoryTrendChartProps {
  data: Array<Record<string, string | number>>
  categories: CategoryMeta[]
}

const COLORS: Record<string, string> = {
  mattress: "#2563eb",
  pump: "#7c3aed",
  scooter: "#f59e0b",
}

export function CategoryTrendChart({ data, categories }: CategoryTrendChartProps) {
  const chartConfig = categories.reduce<ChartConfig>((acc, cat) => {
    acc[cat.key] = {
      label: cat.label,
      color: COLORS[cat.key] ?? "#6b7280",
    }
    return acc
  }, {})

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="mb-4">
          <p className="text-sm font-medium text-foreground">品类 GMV 堆叠趋势</p>
          <p className="text-xs text-muted-foreground">近 7 天各品类每日 GMV</p>
        </div>
        <ChartContainer config={chartConfig} className="h-64 w-full">
          <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              {categories.map((cat) => (
                <linearGradient key={cat.key} id={`fill-${cat.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLORS[cat.key] ?? "#6b7280"} stopOpacity={0.4} />
                  <stop offset="95%" stopColor={COLORS[cat.key] ?? "#6b7280"} stopOpacity={0.05} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={4}
              tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value) => `$${Number(value).toLocaleString()}`}
                />
              }
            />
            <ChartLegend content={<ChartLegendContent />} />
            {categories.map((cat) => (
              <Area
                key={cat.key}
                type="monotone"
                dataKey={cat.key}
                stackId="1"
                stroke={COLORS[cat.key] ?? "#6b7280"}
                fill={`url(#fill-${cat.key})`}
                strokeWidth={2}
              />
            ))}
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
