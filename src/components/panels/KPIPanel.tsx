"use client";

import { useEffect, useState } from "react";
import { useAppStore, getCategoryKey } from "@/store/appStore";
import { BarChart3 } from "lucide-react";
import { Area, AreaChart, Bar, BarChart } from "recharts";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Card, CardContent } from "@/components/ui/card";
import { PanelSkeleton } from "@/components/ui/panel-skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type Window = "today" | "yesterday" | "w7" | "w14" | "d30";

interface AsinRow {
  asin: string;
  gmv: number; orders: number; units: number;
  ad_spend: number; ad_sales: number; ad_orders: number;
  impressions: number; clicks: number; sessions: number;
  acos: number | null; tacos: number | null;
  ctr: number | null; cvr: number | null;
  cpc: number | null; roas: number | null;
}

interface KPIData {
  period: string;
  window: string;
  categoryKey: string;
  total: AsinRow;
  byAsin: AsinRow[];
}

function pct(v: number | null): string {
  return v != null ? `${(v * 100).toFixed(1)}%` : "—";
}
function cur(v: number): string {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
function num(v: number): string {
  return v.toLocaleString("en-US");
}

const WINDOWS: { id: Window; label: string }[] = [
  { id: "today", label: "今天" },
  { id: "yesterday", label: "昨天" },
  { id: "w7", label: "7天" },
  { id: "w14", label: "14天" },
  { id: "d30", label: "30天" },
];

/* ---------- Metric card config ---------- */

interface MetricDef {
  label: string;
  value: (t: AsinRow) => string;
  raw: (t: AsinRow) => number;
  color: string;
  warn?: (t: AsinRow) => boolean;
}

const METRIC_DEFS: MetricDef[] = [
  { label: "GMV",    value: t => cur(t.gmv),      raw: t => t.gmv,      color: "#2563eb" },
  { label: "订单量",  value: t => num(t.orders),    raw: t => t.orders,   color: "#7c3aed" },
  { label: "广告花费", value: t => cur(t.ad_spend),  raw: t => t.ad_spend, color: "#f59e0b" },
  { label: "ACoS",   value: t => pct(t.acos),      raw: t => (t.acos ?? 0) * 100, color: "#06b6d4", warn: t => t.acos != null && t.acos > 0.5 },
  { label: "CTR",    value: t => pct(t.ctr),        raw: t => (t.ctr ?? 0) * 100,  color: "#8b5cf6" },
  { label: "ROAS",   value: t => t.roas != null ? t.roas.toFixed(2) : "—", raw: t => t.roas ?? 0, color: "#10b981" },
];

/* ---------- Mini chart for ASIN comparison ---------- */

const barConfig = { value: { label: "Value", color: "#3b82f6" } } satisfies ChartConfig;

function AsinBarChart({ data, dataKey }: { data: Array<{ name: string; value: number }>; dataKey: string }) {
  if (data.length === 0) return null;
  return (
    <ChartContainer config={barConfig} className="h-24 w-full">
      <BarChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="value" fill="var(--color-value)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}

/* ---------- Main component ---------- */

export default function KPIPanel() {
  const { activeNav } = useAppStore();
  const activeCategoryKey = getCategoryKey(activeNav);
  const [window, setWindow] = useState<Window>("w7");
  const [data, setData] = useState<KPIData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ window });
    if (activeCategoryKey) params.set("categoryKey", activeCategoryKey);
    fetch(`/api/features/kpi?${params}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error as string); return; }
        setData(d as KPIData);
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [activeCategoryKey, window]);

  return (
    <div className="h-full overflow-y-auto p-6 bg-background">
      {/* Header + time window tabs */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-foreground">
            {activeCategoryKey ? `${activeCategoryKey} KPI` : "全品类 KPI"}
          </h1>
          {data && <p className="text-xs mt-0.5 text-muted-foreground">{data.period}</p>}
        </div>
        <Tabs value={window} onValueChange={(v) => setWindow(v as Window)}>
          <TabsList>
            {WINDOWS.map(({ id, label }) => (
              <TabsTrigger key={id} value={id} className="text-xs">
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {loading && <PanelSkeleton />}

      {!loading && error && (
        <div className="flex items-center justify-center h-[60vh]">
          <Card className="max-w-sm">
            <CardContent className="text-center space-y-3 py-8">
              <BarChart3 size={40} className="mx-auto text-muted-foreground/50" />
              <h3 className="font-semibold text-foreground">暂无数据</h3>
              <p className="text-sm text-muted-foreground">上传产品报表后，KPI 汇总将自动计算</p>
            </CardContent>
          </Card>
        </div>
      )}

      {!loading && data && (
        <>
          {/* KPI Summary Cards */}
          <div className="grid grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
            {METRIC_DEFS.map(metric => {
              const isWarn = metric.warn?.(data.total);
              return (
                <Card key={metric.label} className="overflow-hidden">
                  <CardContent className="p-3 pb-0">
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
                      {metric.label}
                    </p>
                    <p className={cn(
                      "text-xl font-bold font-mono",
                      isWarn ? "text-destructive" : "text-foreground"
                    )}>
                      {metric.value(data.total)}
                    </p>
                  </CardContent>
                  {/* Mini area chart showing ASIN breakdown as bars */}
                  <div className="px-1 mt-1">
                    <AsinBarChart
                      data={data.byAsin.map(a => ({ name: a.asin.slice(-5), value: metric.raw(a) }))}
                      dataKey="value"
                    />
                  </div>
                </Card>
              );
            })}
          </div>

          {/* Per-ASIN detail table */}
          {data.byAsin.length === 0 ? (
            <p className="text-center text-sm py-10 text-muted-foreground">无 ASIN 数据</p>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    {["ASIN", "GMV", "订单", "广告花费", "ACoS", "TACoS", "CTR", "CVR", "CPC", "ROAS"].map(h => (
                      <TableHead key={h} className="text-xs text-muted-foreground font-semibold">{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.byAsin.map(row => (
                    <TableRow key={row.asin} className="hover:bg-muted/30">
                      <TableCell className="font-mono text-xs">{row.asin}</TableCell>
                      <TableCell className="font-mono text-sm font-medium">{cur(row.gmv)}</TableCell>
                      <TableCell className="font-mono text-sm">{num(row.orders)}</TableCell>
                      <TableCell className="font-mono text-sm">{cur(row.ad_spend)}</TableCell>
                      <TableCell className={cn("font-mono text-sm font-medium", row.acos != null && row.acos > 0.5 && "text-destructive")}>
                        {pct(row.acos)}
                      </TableCell>
                      <TableCell className="font-mono text-sm">{pct(row.tacos)}</TableCell>
                      <TableCell className="font-mono text-sm">{pct(row.ctr)}</TableCell>
                      <TableCell className="font-mono text-sm">{pct(row.cvr)}</TableCell>
                      <TableCell className="font-mono text-sm">{row.cpc != null ? `$${row.cpc}` : "—"}</TableCell>
                      <TableCell className="font-mono text-sm">{row.roas != null ? row.roas.toFixed(2) : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
