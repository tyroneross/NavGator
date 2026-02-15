"use client"

import { useState } from "react"
import {
  ArrowRight,
  ArrowLeft,
  Search,
  Code2,
  FileCode,
  RefreshCw,
  Loader2,
  Info,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { useConnections } from "@/lib/hooks"

interface ConnectionsPanelProps {
  selectedComponent: string | null
  onSelectComponent: (name: string) => void
}

const connectionTypeColors: Record<string, string> = {
  "service-call": "bg-chart-2/20 text-chart-2 border-chart-2/30",
  "api-calls-db": "bg-chart-3/20 text-chart-3 border-chart-3/30",
  "frontend-calls-api": "bg-chart-1/20 text-chart-1 border-chart-1/30",
  "queue-triggers": "bg-chart-4/20 text-chart-4 border-chart-4/30",
  "observes": "bg-info/20 text-info border-info/30",
  "conforms-to": "bg-primary/20 text-primary border-primary/30",
  "notifies": "bg-chart-5/20 text-chart-5 border-chart-5/30",
  "stores": "bg-warning/20 text-warning border-warning/30",
  "navigates-to": "bg-chart-1/20 text-chart-1 border-chart-1/30",
  "requires-entitlement": "bg-destructive/20 text-destructive border-destructive/30",
  "target-contains": "bg-chart-4/20 text-chart-4 border-chart-4/30",
  "generates": "bg-chart-3/20 text-chart-3 border-chart-3/30",
  "imports": "bg-muted text-muted-foreground border-muted",
  "prompt-usage": "bg-warning/20 text-warning border-warning/30",
  "deploys-to": "bg-info/20 text-info border-info/30",
  "uses-package": "bg-chart-1/20 text-chart-1 border-chart-1/30",
  "other": "bg-muted text-muted-foreground border-muted",
}

const classificationColors: Record<string, string> = {
  production: "text-gray-600",
  test: "text-amber-600",
  admin: "text-blue-600",
  analytics: "text-green-600",
  "dev-only": "text-purple-600",
  migration: "text-orange-600",
  unknown: "text-gray-400",
}

const connectionTypeLabels: Record<string, string> = {
  "service-call": "Service Calls",
  "api-calls-db": "DB Queries",
  "frontend-calls-api": "API Calls",
  "queue-triggers": "Queue Triggers",
  "observes": "Observes",
  "conforms-to": "Conforms To",
  "notifies": "Notifies",
  "stores": "Stores",
  "navigates-to": "Navigates",
  "requires-entitlement": "Entitlements",
  "target-contains": "Target Contains",
  "generates": "Generates",
  "imports": "Imports",
  "prompt-usage": "Prompt Usage",
  "deploys-to": "Deploys To",
  "uses-package": "Uses Package",
  "other": "Other",
}

export function ConnectionsPanel({ selectedComponent, onSelectComponent }: ConnectionsPanelProps) {
  const { connections, isLoading, source, refresh } = useConnections({ autoFetch: true })
  const [search, setSearch] = useState("")
  const [activeTab, setActiveTab] = useState("all")

  const filtered = connections.filter((c) => {
    const matchesSearch =
      c.from.toLowerCase().includes(search.toLowerCase()) ||
      c.to.toLowerCase().includes(search.toLowerCase()) ||
      c.symbol.toLowerCase().includes(search.toLowerCase())

    if (activeTab === "all") return matchesSearch
    return matchesSearch && c.type === activeTab
  })

  // Dynamically group by connection type (only types that exist in the data)
  const typeCounts = connections.reduce<Record<string, number>>((acc, c) => {
    acc[c.type] = (acc[c.type] || 0) + 1
    return acc
  }, {})
  const activeTypes = Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([type]) => type)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Connections</h1>
          <p className="text-sm text-muted-foreground">
            All detected relationships between components
            {source === "mock" && (
              <span className="ml-2 text-info">(Demo data)</span>
            )}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refresh()}
          disabled={isLoading}
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          <span className="ml-2">Refresh</span>
        </Button>
      </div>

      {source === "mock" && (
        <div className="flex items-center gap-2 rounded-lg border border-info/30 bg-info/10 p-3">
          <Info className="h-4 w-4 text-info" />
          <p className="text-sm text-info">
            Run <code className="rounded bg-info/20 px-1">navgator scan</code> to scan your project for real data.
          </p>
        </div>
      )}

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search connections..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-card pl-9"
        />
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-secondary flex-wrap h-auto gap-1 p-1">
          <TabsTrigger value="all">
            All
            <Badge variant="secondary" className="ml-2 h-5 px-1.5 bg-muted">
              {filtered.length}
            </Badge>
          </TabsTrigger>
          {activeTypes.map((type) => (
            <TabsTrigger key={type} value={type}>
              {connectionTypeLabels[type] || type.replace(/-/g, " ")}
              <Badge variant="secondary" className="ml-2 h-5 px-1.5 bg-muted">
                {typeCounts[type]}
              </Badge>
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value={activeTab} className="mt-4">
          <div className="space-y-3">
            {filtered.map((connection, idx) => (
              <Card
                key={`${connection.id}-${idx}`}
                className="bg-card transition-colors hover:bg-card/80"
              >
                <CardContent className="p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2 text-sm">
                      <button
                        onClick={() => {
                          const name = connection.from.split("/").pop()?.replace(/\.(ts|tsx|js|jsx)$/, "") || connection.from
                          onSelectComponent(name)
                        }}
                        className="flex items-center gap-1.5 rounded bg-secondary px-2 py-1 font-mono text-xs text-foreground hover:bg-secondary/80"
                      >
                        <FileCode className="h-3.5 w-3.5 text-muted-foreground" />
                        {connection.from}
                      </button>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      <button
                        onClick={() => onSelectComponent(connection.to)}
                        className="flex items-center gap-1.5 rounded bg-primary/10 px-2 py-1 font-mono text-xs text-primary hover:bg-primary/20"
                      >
                        {connection.to}
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      {connection.classification && connection.classification !== "unknown" && (
                        <span className={cn("text-xs", classificationColors[connection.classification] || "text-gray-400")}>
                          {connection.classification}
                        </span>
                      )}
                      <Badge
                        variant="outline"
                        className={cn("text-xs", connectionTypeColors[connection.type])}
                      >
                        {connection.type.replace(/-/g, " ")}
                      </Badge>
                    </div>
                  </div>

                  <div className="mt-3 rounded-md bg-secondary/50 p-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Code2 className="h-3.5 w-3.5" />
                      <span className="font-medium text-foreground">{connection.symbol}</span>
                      <span>at line {connection.line}</span>
                    </div>
                    <pre className="mt-2 font-mono text-xs text-muted-foreground overflow-x-auto">
                      {connection.code}
                    </pre>
                  </div>
                </CardContent>
              </Card>
            ))}

            {filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary">
                  <ArrowLeft className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="mt-4 text-sm text-muted-foreground">No connections found</p>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
