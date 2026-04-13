"use client";

import { useAppStore, getCategoryKey, type FuncTab } from "@/store/appStore";
import ChatPanel      from "@/components/panels/ChatPanel";
import OverviewPanel  from "@/components/panels/OverviewPanel";
import KPIPanel       from "@/components/panels/KPIPanel";
import AlertsPanel    from "@/components/panels/AlertsPanel";
import AdsPanel       from "@/components/panels/AdsPanel";
import InventoryPanel from "@/components/panels/InventoryPanel";

export default function MainPanel() {
  const { activeNav, activeFuncTab } = useAppStore();
  const categoryKey = getCategoryKey(activeNav);
  const isCategory  = categoryKey !== null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Panel content */}
      <div className="flex-1 overflow-auto bg-background">
        {activeNav === "overview" && <OverviewPanel key="overview" />}
        {activeNav === "chat"     && <ChatPanel     key="chat" />}
        {isCategory && activeFuncTab === "kpi"       && <KPIPanel       key={categoryKey} />}
        {isCategory && activeFuncTab === "alerts"    && <AlertsPanel    key={categoryKey} />}
        {isCategory && activeFuncTab === "ads"       && <AdsPanel       key={categoryKey} />}
        {isCategory && activeFuncTab === "inventory" && <InventoryPanel key={categoryKey} />}
      </div>
    </div>
  );
}
