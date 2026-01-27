"use client"

import { useState, useEffect } from "react"
import {
  Target,
  ArrowDownToLine,
  ArrowUpFromLine,
  FileCode,
  Code2,
  AlertTriangle,
  CheckCircle2,
  Search,
  Loader2,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { Component, Connection } from "@/lib/types"

interface ImpactAnalysisProps {
  componentName: string | null
  onSelectComponent: (name: string) => void
}

interface ComponentWithConnections {
  component: Component
  incoming: Connection[]
  outgoing: Connection[]
}

export function ImpactAnalysis({ componentName, onSelectComponent }: ImpactAnalysisProps) {
  const [search, setSearch] = useState("")
  const [components, setComponents] = useState<Component[]>([])
  const [connections, setConnections] = useState<Connection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Fetch components and connections from API
  useEffect(() => {
    async function fetchData() {
      setLoading(true)
      setError(null)
      try {
        const [compRes, connRes] = await Promise.all([
          fetch("/api/components?refresh=true"),
          fetch("/api/connections?refresh=true"),
        ])

        const compData = await compRes.json()
        const connData = await connRes.json()

        if (compData.success && compData.data?.components) {
          setComponents(compData.data.components)
        }
        if (connData.success && connData.data?.connections) {
          setConnections(connData.data.connections)
        }

        if (compData.error) {
          setError(compData.error)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data")
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [])

  // Build component data with connections
  const getComponentData = (name: string): ComponentWithConnections | null => {
    const component = components.find(c => c.name === name)
    if (!component) return null

    // Find connections TO this component (incoming)
    const incoming = connections.filter(conn =>
      conn.toComponent === name ||
      conn.to?.includes(component.id) ||
      conn.to === name
    )

    // Find connections FROM this component (outgoing)
    const outgoing = connections.filter(conn =>
      conn.fromComponent === name ||
      conn.from?.includes(component.id) ||
      conn.from === name
    )

    return { component, incoming, outgoing }
  }

  const filteredComponents = components.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  )

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-3 text-muted-foreground">Loading components...</span>
      </div>
    )
  }

  // Error state
  if (error && components.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Impact Analysis</h1>
          <p className="text-sm text-muted-foreground">
            Select a component to see what would be affected by changes
          </p>
        </div>
        <Card className="bg-card border-warning/50">
          <CardContent className="p-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-warning mt-0.5" />
              <div>
                <p className="font-medium text-card-foreground">No scan data found</p>
                <p className="text-sm text-muted-foreground mt-1">{error}</p>
                <p className="text-sm text-muted-foreground mt-2">
                  Run <code className="bg-secondary px-1.5 py-0.5 rounded text-xs">navgator scan</code> in your project to generate architecture data.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  const data = componentName ? getComponentData(componentName) : null

  if (!componentName || !data) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Impact Analysis</h1>
          <p className="text-sm text-muted-foreground">
            Select a component to see what would be affected by changes
          </p>
        </div>

        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search components..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-card pl-9"
          />
        </div>

        {filteredComponents.length === 0 ? (
          <Card className="bg-card">
            <CardContent className="p-6 text-center">
              <p className="text-muted-foreground">No components found</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredComponents.map((comp) => (
              <button
                key={comp.id}
                onClick={() => onSelectComponent(comp.name)}
                className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:bg-secondary"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <Target className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-card-foreground">{comp.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {comp.type} · {comp.layer}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  const riskLevel =
    data.incoming.length >= 5 ? "high" : data.incoming.length >= 3 ? "medium" : "low"

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-foreground">{componentName}</h1>
            <Badge
              variant="outline"
              className={cn(
                "text-xs",
                riskLevel === "high" && "border-destructive/50 bg-destructive/10 text-destructive",
                riskLevel === "medium" && "border-warning/50 bg-warning/10 text-warning",
                riskLevel === "low" && "border-success/50 bg-success/10 text-success"
              )}
            >
              {riskLevel === "high" && <AlertTriangle className="mr-1 h-3 w-3" />}
              {riskLevel === "low" && <CheckCircle2 className="mr-1 h-3 w-3" />}
              {riskLevel} impact risk
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {data.component.type} · {data.component.layer} · {data.component.purpose || "No description"}
          </p>
        </div>
        <button
          onClick={() => onSelectComponent("")}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Clear selection
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="bg-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-chart-1/10">
                <ArrowDownToLine className="h-5 w-5 text-chart-1" />
              </div>
              <div>
                <p className="text-2xl font-semibold text-card-foreground">
                  {data.incoming.length}
                </p>
                <p className="text-sm text-muted-foreground">Incoming connections</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-chart-2/10">
                <ArrowUpFromLine className="h-5 w-5 text-chart-2" />
              </div>
              <div>
                <p className="text-2xl font-semibold text-card-foreground">
                  {data.outgoing.length}
                </p>
                <p className="text-sm text-muted-foreground">Outgoing connections</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Incoming Connections */}
      {data.incoming.length > 0 && (
        <Card className="bg-card">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base font-medium">
              <ArrowDownToLine className="h-4 w-4 text-chart-1" />
              Files that USE this component
              <Badge variant="secondary" className="ml-auto">
                {data.incoming.length}
              </Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              These files may need changes if you modify {componentName}
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.incoming.map((conn, idx) => (
                <div
                  key={idx}
                  className="rounded-lg border border-border bg-secondary/30 p-3"
                >
                  <div className="flex items-center gap-2">
                    <FileCode className="h-4 w-4 text-muted-foreground" />
                    <span className="font-mono text-sm text-foreground">{conn.from}</span>
                    <span className="text-xs text-muted-foreground">:{conn.line}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <Code2 className="h-3.5 w-3.5" />
                    <span className="font-medium text-foreground">{conn.symbol}</span>
                  </div>
                  {conn.code && (
                    <pre className="mt-2 rounded bg-background p-2 font-mono text-xs text-muted-foreground overflow-x-auto">
                      {conn.code}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Outgoing Connections */}
      {data.outgoing.length > 0 && (
        <Card className="bg-card">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base font-medium">
              <ArrowUpFromLine className="h-4 w-4 text-chart-2" />
              Components this CALLS
              <Badge variant="secondary" className="ml-auto">
                {data.outgoing.length}
              </Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              External dependencies of {componentName}
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.outgoing.map((conn, idx) => (
                <button
                  key={idx}
                  onClick={() => conn.toComponent && onSelectComponent(conn.toComponent)}
                  className="w-full rounded-lg border border-border bg-secondary/30 p-3 text-left transition-colors hover:bg-secondary/50"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="bg-primary/10 text-primary">
                      {conn.toComponent || conn.to}
                    </Badge>
                    <span className="text-xs text-muted-foreground">:{conn.line}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <Code2 className="h-3.5 w-3.5" />
                    <span className="font-medium text-foreground">{conn.symbol}</span>
                  </div>
                  {conn.code && (
                    <pre className="mt-2 rounded bg-background p-2 font-mono text-xs text-muted-foreground overflow-x-auto">
                      {conn.code}
                    </pre>
                  )}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* No connections */}
      {data.incoming.length === 0 && data.outgoing.length === 0 && (
        <Card className="bg-card">
          <CardContent className="p-6 text-center">
            <p className="text-muted-foreground">No connections found for this component</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
