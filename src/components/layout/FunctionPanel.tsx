"use client";

import { type ReactNode } from "react";
import { useAppStore, type FuncTab } from "@/store/appStore";
import { BarChart3, AlertTriangle, Target, Package } from "lucide-react";

const FUNC_TABS: { id: FuncTab; label: string; icon: ReactNode }[] = [
  { id: "kpi",       label: "KPI 汇总", icon: <BarChart3 size={14} /> },
  { id: "alerts",    label: "每日告警", icon: <AlertTriangle size={14} /> },
  { id: "ads",       label: "广告优化", icon: <Target size={14} /> },
  { id: "inventory", label: "库存看板", icon: <Package size={14} /> },
];

export default function FunctionPanel() {
  const { activeFuncTab, setActiveFuncTab } = useAppStore();

  return (
    <div className="w-[150px] bg-background border-r border-border flex flex-col shrink-0">
      <div className="px-3 pt-4 pb-2">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-2">
          功能模块
        </div>
      </div>

      <div className="px-2 flex-1">
        {FUNC_TABS.map((tab) => (
          <FuncTabItem
            key={tab.id}
            icon={tab.icon}
            label={tab.label}
            active={activeFuncTab === tab.id}
            onClick={() => setActiveFuncTab(tab.id)}
          />
        ))}
      </div>
    </div>
  );
}

function FuncTabItem({
  icon, label, active, onClick,
}: {
  icon:    ReactNode;
  label:   string;
  active:  boolean;
  onClick: () => void;
}) {
  return (
    <div
      data-active={active}
      onClick={onClick}
      className="flex items-center gap-2 px-2.5 py-2 rounded-[7px] mb-px cursor-pointer
        text-xs text-muted-foreground transition-colors
        hover:bg-muted
        data-[active=true]:bg-primary/5 data-[active=true]:text-primary data-[active=true]:font-semibold"
    >
      <span className="flex items-center">{icon}</span>
      <span>{label}</span>
    </div>
  );
}
