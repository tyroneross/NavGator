"use client"

import { useState } from "react"
import {
  AlertCircle,
  Check,
  ClipboardCopy,
  Loader2,
  Network,
  RefreshCw,
  Search,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/utils"
import { useSubgraph } from "@/lib/hooks"
import { useComponents } from "@/lib/hooks"

const layerOptions = [
  "frontend",
  "backend",
  "data",
  "shared",
  "external",
  "hosting",
]

export function SubgraphPanel() {
  const [focusInput, setFocusInput] = useState("")
  const [focusList, setFocusList] = useState<string[]>([])
  const [depth, setDepth] = useState(2)
  const [selectedLayers, setSelectedLayers] = useState<string[]>([])
  const [maxNodes, setMaxNodes] = useState(50)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [copiedJson, setCopiedJson] = useState(false)
  const [copiedMermaid, setCopiedMermaid] = useState(false)

  const { components } = useComponents({ autoFetch: true })
  const { subgraph, isLoading, error, refresh } = useSubgraph({
    focus: focusList.length > 0 ? focusList : undefined,
    depth,
    layers: selectedLayers.length > 0 ? selectedLayers : undefined,
    maxNodes,
    autoFetch: focusList.length > 0,
  })

  const suggestions =
    focusInput.length > 0
      ? components
          .filter(
            (c) =>
              c.name.toLowerCase().includes(focusInput.toLowerCase()) &&
              !focusList.includes(c.name)
          )
          .slice(0, 6)
      : []

  const addFocus = (name: string) => {
    if (!focusList.includes(name)) {
      setFocusList([...focusList, name])
    }
    setFocusInput("")
    setShowSuggestions(false)
  }

  const removeFocus = (name: string) => {
    setFocusList(focusList.filter((n) => n !== name))
  }

  const toggleLayer = (layer: string) => {
    setSelectedLayers((prev) =>
      prev.includes(layer) ? prev.filter((l) => l !== layer) : [...prev, layer]
    )
  }

  const handleCopyJson = async () => {
    if (!subgraph) return
    await navigator.clipboard.writeText(
      JSON.stringify(
        { components: subgraph.components, connections: subgraph.connections },
        null,
        2
      )
    )
    setCopiedJson(true)
    setTimeout(() => setCopiedJson(false), 2000)
  }

  const handleCopyMermaid = async () => {
    if (!subgraph?.mermaid) return
    await navigator.clipboard.writeText(subgraph.mermaid)
    setCopiedMermaid(true)
    setTimeout(() => setCopiedMermaid(false), 2000)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            Subgraph Export
          </h1>
          <p className="text-sm text-muted-foreground">
            {subgraph
              ? `${subgraph.stats.nodes} nodes, ${subgraph.stats.edges} edges`
              : "Configure filters and extract a subgraph"}
          </p>
        </div>
        {subgraph && (
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

      {/* Filter controls */}
      <Card className="bg-card">
        <CardContent className="space-y-4 p-4">
          {/* Focus multi-select */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Focus Components
            </label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {focusList.map((name) => (
                <Badge
                  key={name}
                  variant="secondary"
                  className="flex items-center gap-1 text-xs"
                >
                  {name}
                  <button
                    onClick={() => removeFocus(name)}
                    className="ml-0.5 rounded-full hover:bg-accent p-0.5"
                  >
                    &times;
                  </button>
                </Badge>
              ))}
            </div>
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Add focus component..."
                value={focusInput}
                onChange={(e) => {
                  setFocusInput(e.target.value)
                  setShowSuggestions(true)
                }}
                onFocus={() => setShowSuggestions(true)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && focusInput.trim()) {
                    addFocus(focusInput.trim())
                  }
                }}
                className="pl-9"
              />
              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-popover shadow-md">
                  {suggestions.map((c) => (
                    <button
                      key={c.id}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => addFocus(c.name)}
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
          </div>

          <div className="flex flex-col gap-4 sm:flex-row">
            {/* Depth */}
            <div className="w-32">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Depth: {depth}
              </label>
              <Slider
                value={[depth]}
                onValueChange={([v]) => setDepth(v)}
                min={1}
                max={5}
                step={1}
              />
            </div>

            {/* Max nodes */}
            <div className="w-32">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Max nodes: {maxNodes}
              </label>
              <Slider
                value={[maxNodes]}
                onValueChange={([v]) => setMaxNodes(v)}
                min={10}
                max={200}
                step={10}
              />
            </div>
          </div>

          {/* Layer checkboxes */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Layers
            </label>
            <div className="flex flex-wrap gap-2">
              {layerOptions.map((layer) => (
                <button
                  key={layer}
                  onClick={() => toggleLayer(layer)}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                    selectedLayers.includes(layer)
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-accent"
                  )}
                >
                  {layer}
                </button>
              ))}
            </div>
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
      {subgraph && !isLoading && (
        <>
          {/* Export buttons */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopyJson}
              disabled={subgraph.stats.nodes === 0}
            >
              {copiedJson ? (
                <Check className="h-4 w-4 text-green-600" />
              ) : (
                <ClipboardCopy className="h-4 w-4" />
              )}
              <span className="ml-2">
                {copiedJson ? "Copied" : "Copy JSON"}
              </span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopyMermaid}
              disabled={!subgraph.mermaid}
            >
              {copiedMermaid ? (
                <Check className="h-4 w-4 text-green-600" />
              ) : (
                <ClipboardCopy className="h-4 w-4" />
              )}
              <span className="ml-2">
                {copiedMermaid ? "Copied" : "Copy Mermaid"}
              </span>
            </Button>
          </div>

          {/* Mermaid preview */}
          {subgraph.mermaid && (
            <Card className="bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Mermaid Diagram
                </CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="max-h-80 overflow-auto rounded-md bg-secondary/50 p-4 font-mono text-xs text-foreground">
                  {subgraph.mermaid}
                </pre>
              </CardContent>
            </Card>
          )}

          {/* Component list */}
          {subgraph.stats.nodes > 0 && (
            <Card className="bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Components ({subgraph.stats.nodes})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="divide-y divide-border">
                  {subgraph.components.map((comp) => (
                    <div
                      key={comp.id}
                      className="flex items-center justify-between py-2 first:pt-0 last:pb-0"
                    >
                      <span className="font-mono text-sm text-foreground">
                        {comp.n}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {comp.t}
                        </span>
                        <Badge variant="secondary" className="text-[10px]">
                          {comp.l}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Empty result */}
          {subgraph.stats.nodes === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary">
                <Network className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="mt-4 text-sm font-medium text-foreground">
                No components match
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Try adding focus components or adjusting filters.
              </p>
            </div>
          )}
        </>
      )}

      {/* Initial empty state */}
      {!subgraph && !isLoading && !error && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary">
            <Network className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="mt-4 text-sm font-medium text-foreground">
            Configure filters and extract a subgraph
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add focus components to extract a focused slice of your
            architecture.
          </p>
        </div>
      )}
    </div>
  )
}
