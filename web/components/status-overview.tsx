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
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import type { View } from "@/app/page"

interface StatusOverviewProps {
  onSelectComponent: (name: string) => void
  onNavigate: (view: View) => void
}

const stats = [
  { label: "Components", value: "15", icon: Boxes, trend: "+2", view: "components" as View },
  { label: "Connections", value: "23", icon: GitBranch, trend: "+5", view: "connections" as View },
  { label: "LLM Calls", value: "8", icon: Brain, trend: "+3", view: "llm" as View },
  { label: "Health", value: "Good", icon: CheckCircle2, status: "success", view: "settings" as View },
]

const componentsByType = [
  { type: "npm", count: 8, icon: Package, color: "text-chart-1" },
  { type: "service", count: 4, icon: Cloud, color: "text-chart-2" },
  { type: "database", count: 2, icon: Database, color: "text-chart-3" },
  { type: "infra", count: 1, icon: Server, color: "text-chart-4" },
]

const recentComponents = [
  { name: "Stripe", type: "service", layer: "external", connections: 3 },
  { name: "PostgreSQL", type: "database", layer: "data", connections: 8 },
  { name: "BullMQ", type: "queue", layer: "backend", connections: 5 },
  { name: "Next.js", type: "framework", layer: "frontend", connections: 12 },
  { name: "Redis", type: "database", layer: "data", connections: 4 },
]

const quickActions = [
  { label: "Run Full Scan", description: "Analyze entire codebase", icon: Activity, view: "settings" as View },
  { label: "View Diagram", description: "Architecture visualization", icon: GitBranch, view: "diagram" as View },
  { label: "Impact Analysis", description: "Check change effects", icon: AlertTriangle, view: "impact" as View },
]

export function StatusOverview({ onSelectComponent, onNavigate }: StatusOverviewProps) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Architecture Status</h1>
        <p className="text-sm text-muted-foreground">
          Overview of your project architecture and connections
        </p>
      </div>

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
            <div className="space-y-2">
              {componentsByType.map((item) => (
                <button
                  key={item.type}
                  onClick={() => onNavigate("components")}
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
                        style={{ width: `${(item.count / 8) * 100}%` }}
                      />
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Recent Components */}
        <Card className="bg-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">Top Connected Components</CardTitle>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
