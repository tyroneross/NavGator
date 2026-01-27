"use client"

import { useState } from "react"
import { Header } from "@/components/header"
import { Sidebar } from "@/components/sidebar"
import { StatusOverview } from "@/components/status-overview"
import { ComponentsPanel } from "@/components/components-panel"
import { ConnectionsPanel } from "@/components/connections-panel"
import { ImpactAnalysis } from "@/components/impact-analysis"
import { DiagramView } from "@/components/diagram-view"
import { LLMTrackingPanel } from "@/components/llm-tracking-panel"
import { SettingsPanel } from "@/components/settings-panel"

export type View = "overview" | "components" | "connections" | "impact" | "diagram" | "llm" | "settings"

export default function Dashboard() {
  const [activeView, setActiveView] = useState<View>("overview")
  const [selectedComponent, setSelectedComponent] = useState<string | null>(null)

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <div className="flex flex-1">
        <Sidebar activeView={activeView} setActiveView={setActiveView} />
        <main className="flex-1 overflow-auto p-6">
          {activeView === "overview" && (
            <StatusOverview
              onSelectComponent={(name) => {
                setSelectedComponent(name)
                setActiveView("impact")
              }}
              onNavigate={setActiveView}
            />
          )}
          {activeView === "components" && (
            <ComponentsPanel
              onSelectComponent={(name) => {
                setSelectedComponent(name)
                setActiveView("impact")
              }}
            />
          )}
          {activeView === "connections" && (
            <ConnectionsPanel
              selectedComponent={selectedComponent}
              onSelectComponent={setSelectedComponent}
            />
          )}
          {activeView === "impact" && (
            <ImpactAnalysis
              componentName={selectedComponent}
              onSelectComponent={setSelectedComponent}
            />
          )}
          {activeView === "diagram" && (
            <DiagramView selectedComponent={selectedComponent} />
          )}
          {activeView === "llm" && <LLMTrackingPanel />}
          {activeView === "settings" && <SettingsPanel />}
        </main>
      </div>
    </div>
  )
}
