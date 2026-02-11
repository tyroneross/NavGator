"use client"

import {
  Boxes,
  GitBranch,
  Clock,
  CheckCircle2,
  Package,
  Database,
  Cloud,
  Server,
  ChevronRight,
  AlertTriangle,
  Activity,
  Brain,
  Loader2,
  Info,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useStatus, useComponents, usePrompts } from "@/lib/hooks"
import type { View } from "@/app/page"

interface StatusOverviewProps {
  onSelectComponent: (name: string) => void
  onNavigate: (view: View) => void
  onNavigateToType?: (type: string) => void
}

const typeIcons: Record<string, typeof Package> = {
  npm: Package,
  pip: Package,
  cargo: Package,
  service: Cloud,
  database: Database,
  queue: Server,
  infra: Server,
  framework: Boxes,
  prompt: Brain,
}

const typeColors: Record<string, string> = {
  npm: "text-chart-1",
  pip: "text-chart-1",
  cargo: "text-chart-1",
  service: "text-chart-2",
  database: "text-chart-3",
  queue: "text-chart-4",
  infra: "text-chart-5",
  framework: "text-primary",
  prompt: "text-info",
}

const quickActions = [
  { label: "Run Full Scan", description: "Analyze entire codebase", icon: Activity, view: "settings" as View },
  { label: "View Diagram", description: "Architecture visualization", icon: GitBranch, view: "diagram" as View },
  { label: "Impact Analysis", description: "Check change effects", icon: AlertTriangle, view: "impact" as View },
]

export function StatusOverview({ onSelectComponent, onNavigate, onNavigateToType }: StatusOverviewProps) {
  const { status, isLoading: statusLoading, error: statusError } = useStatus({ autoFetch: true })
  const { components, summary: componentsSummary, isLoading: componentsLoading } = useComponents({ autoFetch: true })
  const { calls, prompts, isLoading: promptsLoading } = usePrompts({ autoFetch: true })

  const isLoading = statusLoading || componentsLoading || promptsLoading

  // Count LLM issues for the stat card badge
  const llmIssueCount = (() => {
    let count = 0
    for (const call of calls) {
      if (call.provider === "unknown") count++
      if (call.model === "unknown") count++
    }
    for (const prompt of prompts) {
      if (prompt.usedBy.length === 0) count++
    }
    return count
  })()

  // Build stats from real data
  const stats = [
    {
      label: "Components",
      value: status?.stats.total_components?.toString() || "0",
      icon: Boxes,
      trend: componentsSummary?.outdatedCount ? `${componentsSummary.outdatedCount} outdated` : undefined,
      view: "components" as View,
    },
    {
      label: "Connections",
      value: status?.stats.total_connections?.toString() || "0",
      icon: GitBranch,
      view: "connections" as View,
    },
    {
      label: "LLM Calls",
      value: calls.length.toString(),
      icon: Brain,
      trend: llmIssueCount > 0 ? `${llmIssueCount} issues` : undefined,
      view: "llm" as View,
    },
    {
      label: "Health",
      value: status?.stats.vulnerable_count === 0 ? "Good" : "Issues",
      icon: CheckCircle2,
      status: status?.stats.vulnerable_count === 0 ? "success" : "warning",
      view: "settings" as View,
    },
  ]

  // Build components by type from real data
  const componentsByType = Object.entries(status?.stats.components_by_type || {})
    .map(([type, count]) => ({
      type,
      count,
      icon: typeIcons[type] || Package,
      color: typeColors[type] || "text-muted-foreground",
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)

  // Get top connected components from real data
  const recentComponents = components
    .map((c) => ({
      name: c.name,
      type: c.type,
      layer: c.layer,
      connections: c.connections,
    }))
    .sort((a, b) => b.connections - a.connections)
    .slice(0, 5)
  // Show loading state
  if (isLoading && !status) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // Show empty state if no scan data
  const hasData = status && status.stats.total_components > 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Architecture Status</h1>
        <p className="text-sm text-muted-foreground">
          {status?.project_name
            ? `Overview of ${status.project_name} architecture and connections`
            : "Overview of your project architecture and connections"}
        </p>
      </div>

      {!hasData && (
        <div className="flex items-center gap-2 rounded-lg border border-info/30 bg-info/10 p-4">
          <Info className="h-5 w-5 text-info" />
          <div>
            <p className="text-sm font-medium text-info">No scan data found</p>
            <p className="text-xs text-info/80">
              Run <code className="rounded bg-info/20 px-1.5 py-0.5">navgator setup</code> to scan your project.
            </p>
          </div>
        </div>
      )}

      {/* Stats Grid - Clickable Navigation */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <button
            key={stat.label}
            onClick={() => stat.view && onNavigate(stat.view)}
            className="group text-left"
          >
            <Card className="bg-card transition-all duration-200 group-hover:border-primary/50 group-hover:bg-secondary/50">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary transition-colors group-hover:bg-primary/10">
                    <stat.icon className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex items-center gap-2">
                    {stat.trend && (
                      <Badge variant="secondary" className="bg-primary/10 text-primary">
                        {stat.trend}
                      </Badge>
                    )}
                    {stat.status === "success" && (
                      <Badge variant="secondary" className="bg-success/10 text-success">
                        Healthy
                      </Badge>
                    )}
                    {stat.status === "warning" && (
                      <Badge variant="secondary" className="bg-warning/10 text-warning">
                        Issues
                      </Badge>
                    )}
                    <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </div>
                </div>
                <div className="mt-3">
                  <p className="text-2xl font-semibold text-card-foreground">{stat.value}</p>
                  <p className="text-sm text-muted-foreground">{stat.label}</p>
                </div>
              </CardContent>
            </Card>
          </button>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="grid gap-3 sm:grid-cols-3">
        {quickActions.map((action) => (
          <button
            key={action.label}
            onClick={() => onNavigate(action.view)}
            className="group flex items-center gap-3 rounded-lg border border-border bg-card p-4 text-left transition-all hover:border-primary/50 hover:bg-secondary/50"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary transition-colors group-hover:bg-primary/10">
              <action.icon className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-card-foreground">{action.label}</p>
              <p className="truncate text-xs text-muted-foreground">{action.description}</p>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Components by Type */}
        <Card className="bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base font-medium">Components by Type</CardTitle>
            <button
              onClick={() => onNavigate("components")}
              className="text-xs text-muted-foreground transition-colors hover:text-primary"
            >
              View all
            </button>
          </CardHeader>
          <CardContent>
            {componentsByType.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No components scanned yet
              </p>
            ) : (
              <div className="space-y-2">
                {componentsByType.map((item) => (
                  <button
                    key={item.type}
                    onClick={() => onNavigateToType ? onNavigateToType(item.type) : onNavigate("components")}
                    className="group flex w-full items-center gap-3 rounded-md p-2 transition-colors hover:bg-secondary"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded bg-secondary transition-colors group-hover:bg-primary/10">
                      <item.icon className={`h-4 w-4 ${item.color}`} />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-card-foreground capitalize">
                          {item.type}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-muted-foreground">{item.count}</span>
                          <ChevronRight className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                        </div>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${Math.min(100, (item.count / Math.max(...componentsByType.map(c => c.count), 1)) * 100)}%` }}
                        />
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Components */}
        <Card className="bg-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">Top Connected Components</CardTitle>
          </CardHeader>
          <CardContent>
            {recentComponents.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No components scanned yet
              </p>
            ) : (
              <div className="space-y-2">
                {recentComponents.map((component) => (
                  <button
                    key={component.name}
                    onClick={() => onSelectComponent(component.name)}
                    className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left transition-colors hover:bg-secondary"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded bg-primary/10">
                        <span className="text-xs font-medium text-primary">
                          {component.name.slice(0, 2).toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-card-foreground">{component.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {component.type} · {component.layer}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">{component.connections}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
