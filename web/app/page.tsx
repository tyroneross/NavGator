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
import { useProjects } from "@/lib/hooks"
import { useActiveProject } from "@/lib/project-context"
import { useStatus } from "@/lib/hooks"

export type View = "overview" | "components" | "connections" | "impact" | "diagram" | "llm" | "settings"

export default function Dashboard() {
  const [activeView, setActiveView] = useState<View>("overview")
  const [selectedComponent, setSelectedComponent] = useState<string | null>(null)
  const [initialTypeFilter, setInitialTypeFilter] = useState<string | null>(null)

  const { activeProjectPath, setActiveProjectPath } = useActiveProject()
  const { projects, isLoading: isLoadingProjects, addProject, removeProject } = useProjects()
  const { status } = useStatus({ autoFetch: true })

  const handleSelectProject = (path: string) => {
    setActiveProjectPath(path)
    // Reset view state when switching projects
    setActiveView("overview")
    setSelectedComponent(null)
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header
        activeProject={activeProjectPath}
        projectName={status?.project_name || null}
        projectPath={status?.project_path || activeProjectPath}
        projects={projects}
        onSelectProject={handleSelectProject}
        onAddProject={addProject}
        onRemoveProject={removeProject}
        isLoadingProjects={isLoadingProjects}
      />
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
              onNavigateToType={(type) => {
                setInitialTypeFilter(type)
                setActiveView("components")
              }}
            />
          )}
          {activeView === "components" && (
            <ComponentsPanel
              initialTypeFilter={initialTypeFilter}
              onSelectComponent={(name) => {
                setSelectedComponent(name)
                setInitialTypeFilter(null)
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
