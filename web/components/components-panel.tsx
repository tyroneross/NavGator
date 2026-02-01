"use client"

import { useState } from "react"
import {
  Package,
  Database,
  Cloud,
  Server,
  Box,
  Search,
  Filter,
  ChevronRight,
  RefreshCw,
  Loader2,
  Info,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { useComponents } from "@/lib/hooks"

interface ComponentsPanelProps {
  onSelectComponent: (name: string) => void
  initialTypeFilter?: string | null
}

const typeIcons: Record<string, typeof Package> = {
  npm: Package,
  service: Cloud,
  database: Database,
  infra: Server,
  queue: Box,
  framework: Box,
}

const typeColors: Record<string, string> = {
  npm: "text-chart-1",
  service: "text-chart-2",
  database: "text-chart-3",
  infra: "text-chart-4",
  queue: "text-chart-5",
  framework: "text-primary",
}

export function ComponentsPanel({ onSelectComponent, initialTypeFilter }: ComponentsPanelProps) {
  const { components, isLoading, source, refresh } = useComponents({ autoFetch: true })
  const [search, setSearch] = useState("")
  const [selectedTypes, setSelectedTypes] = useState<string[]>(initialTypeFilter ? [initialTypeFilter] : [])
  const [selectedLayers, setSelectedLayers] = useState<string[]>([])

  const types = [...new Set(components.map((c) => c.type))]
  const layers = [...new Set(components.map((c) => c.layer))]

  const filtered = components.filter((c) => {
    const matchesSearch = c.name.toLowerCase().includes(search.toLowerCase())
    const matchesType = selectedTypes.length === 0 || selectedTypes.includes(c.type)
    const matchesLayer = selectedLayers.length === 0 || selectedLayers.includes(c.layer)
    return matchesSearch && matchesType && matchesLayer
  })

  const grouped = filtered.reduce(
    (acc, c) => {
      if (!acc[c.type]) acc[c.type] = []
      acc[c.type].push(c)
      return acc
    },
    {} as Record<string, typeof components>
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Components</h1>
          <p className="text-sm text-muted-foreground">
            All detected packages, services, and infrastructure
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

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Filter components..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-card pl-9"
          />
        </div>
        <div className="flex gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2 bg-transparent">
                <Filter className="h-4 w-4" />
                Type
                {selectedTypes.length > 0 && (
                  <Badge variant="secondary" className="ml-1 h-5 px-1.5">
                    {selectedTypes.length}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {types.map((type) => (
                <DropdownMenuCheckboxItem
                  key={type}
                  checked={selectedTypes.includes(type)}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      setSelectedTypes([...selectedTypes, type])
                    } else {
                      setSelectedTypes(selectedTypes.filter((t) => t !== type))
                    }
                  }}
                >
                  <span className="capitalize">{type}</span>
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2 bg-transparent">
                <Filter className="h-4 w-4" />
                Layer
                {selectedLayers.length > 0 && (
                  <Badge variant="secondary" className="ml-1 h-5 px-1.5">
                    {selectedLayers.length}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {layers.map((layer) => (
                <DropdownMenuCheckboxItem
                  key={layer}
                  checked={selectedLayers.includes(layer)}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      setSelectedLayers([...selectedLayers, layer])
                    } else {
                      setSelectedLayers(selectedLayers.filter((l) => l !== layer))
                    }
                  }}
                >
                  <span className="capitalize">{layer}</span>
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Components List */}
      <div className="grid gap-4 lg:grid-cols-2">
        {Object.entries(grouped).map(([type, components]) => {
          const Icon = typeIcons[type] || Box
          const color = typeColors[type] || "text-muted-foreground"

          return (
            <Card key={type} className="bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base font-medium">
                  <Icon className={cn("h-4 w-4", color)} />
                  <span className="capitalize">{type}</span>
                  <Badge variant="secondary" className="ml-auto">
                    {components.length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="divide-y divide-border">
                  {components.map((component) => (
                    <button
                      key={`${component.type}-${component.name}`}
                      onClick={() => onSelectComponent(component.name)}
                      className="flex w-full items-center justify-between py-2.5 text-left transition-colors hover:bg-secondary/50 -mx-2 px-2 rounded"
                    >
                      <div>
                        <p className="text-sm font-medium text-card-foreground">
                          {component.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {component.version ? `v${component.version}` : component.purpose} ·{" "}
                          {component.layer}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {component.connections} conn
                        </span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
