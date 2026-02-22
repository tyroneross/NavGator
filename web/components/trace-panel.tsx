"use client"

import { useState } from "react"
import {
  AlertCircle,
  ArrowRight,
  Loader2,
  RefreshCw,
  Route,
  Search,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/utils"
import { useTrace } from "@/lib/hooks"
import { useComponents } from "@/lib/hooks"

const directionOptions = [
  { value: "forward" as const, label: "Forward" },
  { value: "backward" as const, label: "Backward" },
  { value: "both" as const, label: "Both" },
]

const classificationColors: Record<string, string> = {
  production: "text-gray-600",
  test: "text-amber-600",
  admin: "text-blue-600",
  analytics: "text-green-600",
  "dev-only": "text-purple-600",
  migration: "text-orange-600",
  unknown: "text-gray-400",
}

export function TracePanel() {
  const [query, setQuery] = useState("")
  const [activeComponent, setActiveComponent] = useState("")
  const [direction, setDirection] = useState<"forward" | "backward" | "both">(
    "both"
  )
  const [maxDepth, setMaxDepth] = useState(5)
  const [showSuggestions, setShowSuggestions] = useState(false)

  const { components } = useComponents({ autoFetch: true })
  const { trace, isLoading, error, refresh } = useTrace({
    component: activeComponent || undefined,
    direction,
    maxDepth,
    autoFetch: !!activeComponent,
  })

  // Filter component names for autocomplete
  const suggestions = query.length > 0
    ? components
        .filter((c) =>
          c.name.toLowerCase().includes(query.toLowerCase())
        )
        .slice(0, 8)
    : []

  const handleTrace = () => {
    if (query.trim()) {
      setActiveComponent(query.trim())
    }
  }

  const handleSelectSuggestion = (name: string) => {
    setQuery(name)
    setActiveComponent(name)
    setShowSuggestions(false)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            Dataflow Trace
          </h1>
          <p className="text-sm text-muted-foreground">
            {trace
              ? `${trace.paths.length} path${trace.paths.length !== 1 ? "s" : ""} found, ${trace.components_touched.length} components touched`
              : "Select a component and trace its dataflow"}
          </p>
        </div>
        {activeComponent && (
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
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
          <AlertCircle className="h-4 w-4 text-destructive" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Controls */}
      <Card className="bg-card">
        <CardContent className="p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            {/* Component input with autocomplete */}
            <div className="relative flex-1">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Component
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search components..."
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value)
                    setShowSuggestions(true)
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleTrace()
                      setShowSuggestions(false)
                    }
                  }}
                  className="pl-9"
                />
              </div>
              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-popover shadow-md">
                  {suggestions.map((c) => (
                    <button
                      key={c.id}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleSelectSuggestion(c.name)}
                    >
                      <span className="font-medium text-foreground">
                        {c.name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {c.layer}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Direction toggle */}
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Direction
              </label>
              <div className="flex rounded-md border border-border">
                {directionOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setDirection(opt.value)}
                    className={cn(
                      "px-3 py-2 text-xs font-medium transition-colors",
                      direction === opt.value
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent"
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Depth slider */}
            <div className="w-32">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Depth: {maxDepth}
              </label>
              <Slider
                value={[maxDepth]}
                onValueChange={([v]) => setMaxDepth(v)}
                min={1}
                max={10}
                step={1}
              />
            </div>

            <Button
              onClick={handleTrace}
              disabled={!query.trim() || isLoading}
              size="sm"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Route className="h-4 w-4" />
              )}
              <span className="ml-2">Trace</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Loading */}
      {isLoading && (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Results */}
      {trace && !isLoading && (
        <>
          {/* Layers crossed */}
          {trace.layers_crossed.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium">Layers:</span>
              {trace.layers_crossed.map((layer) => (
                <Badge key={layer} variant="secondary" className="text-xs">
                  {layer}
                </Badge>
              ))}
            </div>
          )}

          {/* Paths */}
          <div className="space-y-3">
            {trace.paths.map((tracePath, i) => (
              <Card key={i} className="bg-card">
                <CardContent className="p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      Path {i + 1}
                    </span>
                    {tracePath.classification && (
                      <span
                        className={cn(
                          "text-xs",
                          classificationColors[tracePath.classification] ||
                            "text-gray-400"
                        )}
                      >
                        {tracePath.classification}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {tracePath.steps.map((step, j) => (
                      <div key={j} className="flex items-center gap-1">
                        {j > 0 && (
                          <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        )}
                        <div className="flex items-center gap-1 rounded bg-secondary px-2 py-1">
                          <span className="font-mono text-xs text-foreground">
                            {step.component.n}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            [{step.component.l}]
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {tracePath.steps.some((s) => s.file) && (
                    <div className="mt-2 text-[10px] text-muted-foreground">
                      {tracePath.steps
                        .filter((s) => s.file)
                        .map((s, k) => (
                          <span key={k} className="mr-3">
                            {s.file}
                            {s.line ? `:${s.line}` : ""}
                          </span>
                        ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Empty result */}
          {trace.paths.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary">
                <Route className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="mt-4 text-sm font-medium text-foreground">
                No paths found
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Try adjusting the direction or increasing the depth.
              </p>
            </div>
          )}
        </>
      )}

      {/* Initial empty state */}
      {!trace && !isLoading && !error && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary">
            <Route className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="mt-4 text-sm font-medium text-foreground">
            Select a component and trace its dataflow
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Search for a component above, then click Trace to follow its
            connections.
          </p>
        </div>
      )}
    </div>
  )
}
