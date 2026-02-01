"use client"

import { useState, useCallback, useEffect, useMemo, useRef } from "react"
import {
  Copy,
  Check,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Loader2,
  Info,
  X,
  ArrowRight,
  Server,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useActiveProject } from "@/lib/project-context"

interface DiagramViewProps {
  selectedComponent: string | null
}

interface GraphNode {
  id: string
  name: string
  type: string
  layer: string
  version?: string
  purpose?: string
  configFiles?: string[]
  tags?: string[]
  connectsTo?: string[]
  connectedFrom?: string[]
  hostedBy?: string
  hosts?: string[]
}

interface GraphEdge {
  id: string
  source: string
  target: string
  type: string
  label?: string
}

interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
  metadata?: { component_count: number; connection_count: number }
}

// Demo data used when no real graph exists
const DEMO_NODES: GraphNode[] = [
  { id: "nextjs", name: "Next.js", type: "framework", layer: "frontend" },
  { id: "react", name: "React", type: "npm", layer: "frontend" },
  { id: "payments", name: "payments.ts", type: "service", layer: "backend" },
  { id: "users", name: "users.ts", type: "service", layer: "backend" },
  { id: "postgres", name: "PostgreSQL", type: "database", layer: "database" },
  { id: "redis", name: "Redis", type: "database", layer: "database" },
  { id: "openai", name: "OpenAI", type: "llm", layer: "external" },
  { id: "stripe", name: "Stripe", type: "service", layer: "external" },
]

const DEMO_EDGES: GraphEdge[] = [
  { id: "e1", source: "nextjs", target: "payments", type: "service-call", label: "API" },
  { id: "e2", source: "nextjs", target: "users", type: "service-call", label: "API" },
  { id: "e3", source: "payments", target: "postgres", type: "service-call", label: "query" },
  { id: "e4", source: "payments", target: "stripe", type: "service-call", label: "call" },
  { id: "e5", source: "users", target: "postgres", type: "service-call", label: "query" },
  { id: "e6", source: "users", target: "redis", type: "service-call", label: "cache" },
  { id: "e7", source: "users", target: "openai", type: "service-call", label: "call" },
]

const LAYER_ORDER = ["frontend", "backend", "database", "queue", "infra", "external"]
const LAYER_LABELS: Record<string, string> = {
  frontend: "Frontend",
  backend: "Backend",
  database: "Data Layer",
  queue: "Queue / Workers",
  infra: "Infrastructure",
  external: "External Services",
}

const typeColors: Record<string, { bg: string; border: string; text: string }> = {
  framework: { bg: "fill-chart-1/20", border: "stroke-chart-1", text: "fill-chart-1" },
  npm: { bg: "fill-chart-1/10", border: "stroke-chart-1/50", text: "fill-foreground" },
  service: { bg: "fill-chart-2/20", border: "stroke-chart-2", text: "fill-chart-2" },
  database: { bg: "fill-chart-3/20", border: "stroke-chart-3", text: "fill-chart-3" },
  queue: { bg: "fill-chart-4/20", border: "stroke-chart-4", text: "fill-chart-4" },
  llm: { bg: "fill-warning/20", border: "stroke-warning", text: "fill-warning" },
  infra: { bg: "fill-info/20", border: "stroke-info", text: "fill-info" },
}

function layoutGraph(graphNodes: GraphNode[], direction: "TB" | "LR") {
  // Group nodes by layer
  const byLayer = new Map<string, GraphNode[]>()
  for (const node of graphNodes) {
    const layer = node.layer || "backend"
    if (!byLayer.has(layer)) byLayer.set(layer, [])
    byLayer.get(layer)!.push(node)
  }

  const activeLayers = LAYER_ORDER.filter((l) => (byLayer.get(l)?.length || 0) > 0)

  const NODE_W = 110
  const NODE_H = 40
  const H_GAP = 20
  const LAYER_PAD = 40
  const LAYER_GAP = 30

  const layers: { id: string; label: string; x: number; y: number; width: number; height: number }[] = []
  const positioned: { id: string; label: string; type: string; layer: string; x: number; y: number; node: GraphNode }[] = []

  let currentY = 40
  for (const layerId of activeLayers) {
    const group = byLayer.get(layerId) || []
    // Cap at 12 nodes per layer to keep diagram readable
    const visible = group.slice(0, 12)
    const rowWidth = visible.length * (NODE_W + H_GAP) - H_GAP
    const layerWidth = Math.max(rowWidth + LAYER_PAD * 2, 200)

    layers.push({
      id: layerId,
      label: LAYER_LABELS[layerId] || layerId,
      x: 40,
      y: currentY,
      width: layerWidth,
      height: NODE_H + LAYER_PAD + 20,
    })

    const startX = 40 + LAYER_PAD
    visible.forEach((node, i) => {
      positioned.push({
        id: node.id,
        label: node.name,
        type: node.type,
        layer: node.layer,
        x: startX + i * (NODE_W + H_GAP),
        y: currentY + 30,
        node,
      })
    })

    if (group.length > 12) {
      positioned.push({
        id: `${layerId}_overflow`,
        label: `+${group.length - 12} more`,
        type: "overflow",
        layer: layerId,
        x: startX + 12 * (NODE_W + H_GAP),
        y: currentY + 30,
        node: { id: `${layerId}_overflow`, name: `+${group.length - 12} more`, type: "overflow", layer: layerId },
      })
    }

    currentY += NODE_H + LAYER_PAD + 20 + LAYER_GAP
  }

  const maxWidth = Math.max(...layers.map((l) => l.x + l.width), 600) + 40
  const totalHeight = currentY + 20

  return { layers, nodes: positioned, svgWidth: maxWidth, svgHeight: totalHeight }
}

// =============================================================================
// NODE DETAIL POPOVER
// =============================================================================

interface NodeDetailProps {
  node: GraphNode
  allNodes: GraphNode[]
  edges: GraphEdge[]
  position: { x: number; y: number }
  onClose: () => void
}

function NodeDetail({ node, allNodes, edges, position, onClose }: NodeDetailProps) {
  const nodeMap = useMemo(() => {
    const m = new Map<string, GraphNode>()
    for (const n of allNodes) m.set(n.id, n)
    return m
  }, [allNodes])

  // Find connections
  const outgoing = edges.filter((e) => e.source === node.id)
  const incoming = edges.filter((e) => e.target === node.id)

  // Find hosted services
  const hostedServices = node.hosts?.map((id) => nodeMap.get(id)).filter(Boolean) || []
  const hostedBy = node.hostedBy ? nodeMap.get(node.hostedBy) : null

  return (
    <div
      className="absolute z-50 w-72 rounded-lg border border-border bg-card shadow-lg"
      style={{ left: position.x, top: position.y }}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-medium text-foreground">{node.name}</span>
          {node.version && (
            <Badge variant="outline" className="text-xs">v{node.version}</Badge>
          )}
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-3 px-4 py-3">
        {/* Type & Layer */}
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs capitalize">{node.type}</Badge>
          <Badge variant="outline" className="text-xs capitalize">{node.layer}</Badge>
        </div>

        {/* Purpose */}
        {node.purpose && (
          <p className="text-xs text-muted-foreground">{node.purpose}</p>
        )}

        {/* Hosted By */}
        {hostedBy && (
          <div>
            <p className="text-xs font-medium text-muted-foreground">Hosted on</p>
            <div className="mt-1 flex items-center gap-1.5">
              <Server className="h-3 w-3 text-info" />
              <span className="text-xs text-foreground">{hostedBy.name}</span>
            </div>
          </div>
        )}

        {/* Hosts */}
        {hostedServices.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground">Hosts</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {hostedServices.map((s) => (
                <Badge key={s!.id} variant="outline" className="text-xs">
                  {s!.name}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Connections */}
        {outgoing.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground">Connects to ({outgoing.length})</p>
            <div className="mt-1 space-y-1">
              {outgoing.slice(0, 5).map((e) => {
                const target = nodeMap.get(e.target)
                return (
                  <div key={e.id} className="flex items-center gap-1.5 text-xs text-foreground">
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    <span>{target?.name || e.target}</span>
                    {e.label && <span className="text-muted-foreground">({e.label})</span>}
                  </div>
                )
              })}
              {outgoing.length > 5 && (
                <p className="text-xs text-muted-foreground">+{outgoing.length - 5} more</p>
              )}
            </div>
          </div>
        )}

        {incoming.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground">Connected from ({incoming.length})</p>
            <div className="mt-1 space-y-1">
              {incoming.slice(0, 5).map((e) => {
                const source = nodeMap.get(e.source)
                return (
                  <div key={e.id} className="flex items-center gap-1.5 text-xs text-foreground">
                    <ArrowRight className="h-3 w-3 rotate-180 text-muted-foreground" />
                    <span>{source?.name || e.source}</span>
                    {e.label && <span className="text-muted-foreground">({e.label})</span>}
                  </div>
                )
              })}
              {incoming.length > 5 && (
                <p className="text-xs text-muted-foreground">+{incoming.length - 5} more</p>
              )}
            </div>
          </div>
        )}

        {/* Config Files */}
        {node.configFiles && node.configFiles.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground">Config files</p>
            <div className="mt-1 space-y-0.5">
              {node.configFiles.slice(0, 3).map((f, i) => (
                <p key={i} className="truncate font-mono text-xs text-muted-foreground">{f.split("/").pop()}</p>
              ))}
            </div>
          </div>
        )}

        {/* Tags */}
        {node.tags && node.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {[...new Set(node.tags)].slice(0, 6).map((tag) => (
              <span key={tag} className="rounded bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// =============================================================================
// MAIN DIAGRAM VIEW
// =============================================================================

export function DiagramView({ selectedComponent }: DiagramViewProps) {
  const [copied, setCopied] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [direction, setDirection] = useState<"TB" | "LR">("TB")
  const [graphData, setGraphData] = useState<GraphData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isDemo, setIsDemo] = useState(false)
  const [showFlowArrows, setShowFlowArrows] = useState(true)
  const [selectedNode, setSelectedNode] = useState<{ node: GraphNode; x: number; y: number } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const { activeProjectPath } = useActiveProject()

  useEffect(() => {
    async function fetchGraph() {
      setIsLoading(true)
      try {
        const params = new URLSearchParams()
        if (activeProjectPath) params.set("path", activeProjectPath)
        const res = await fetch(`/api/graph?${params}`)
        const json = await res.json()
        if (json.success && json.data && json.data.nodes?.length > 0) {
          setGraphData(json.data)
          setIsDemo(false)
        } else {
          setGraphData({ nodes: DEMO_NODES, edges: DEMO_EDGES })
          setIsDemo(true)
        }
      } catch {
        setGraphData({ nodes: DEMO_NODES, edges: DEMO_EDGES })
        setIsDemo(true)
      }
      setIsLoading(false)
    }
    fetchGraph()
  }, [activeProjectPath])

  const currentNodes = graphData?.nodes || DEMO_NODES
  const currentEdges = graphData?.edges || DEMO_EDGES

  const layout = useMemo(
    () => layoutGraph(currentNodes, direction),
    [currentNodes, direction]
  )

  // Filter edges to those where both endpoints are positioned in the layout
  const flowEdges = useMemo(() => {
    const positionedIds = new Set(layout.nodes.map((n) => n.id))
    return currentEdges.filter(
      (e) => e.source !== e.target && positionedIds.has(e.source) && positionedIds.has(e.target)
    )
  }, [currentEdges, layout.nodes])

  // Build hosting groups for visual nesting
  const hostingGroups = useMemo(() => {
    const groups: { host: GraphNode; hosted: GraphNode[] }[] = []
    for (const node of currentNodes) {
      if (node.hosts && node.hosts.length > 0) {
        const hosted = node.hosts
          .map((id) => currentNodes.find((n) => n.id === id))
          .filter(Boolean) as GraphNode[]
        if (hosted.length > 0) {
          groups.push({ host: node, hosted })
        }
      }
    }
    return groups
  }, [currentNodes])

  const handleCopy = useCallback(() => {
    let code = `flowchart ${direction}\n`
    const byLayer = new Map<string, GraphNode[]>()
    for (const n of currentNodes) {
      const l = n.layer || "backend"
      if (!byLayer.has(l)) byLayer.set(l, [])
      byLayer.get(l)!.push(n)
    }
    for (const [layer, group] of byLayer) {
      const label = LAYER_LABELS[layer] || layer
      code += `  subgraph ${label}\n`
      for (const n of group) {
        const shape = n.type === "database" ? `[(${n.name})]` : `[${n.name}]`
        code += `    ${n.id}${shape}\n`
      }
      code += `  end\n`
    }
    code += "\n"
    for (const e of flowEdges) {
      const label = e.label || e.type
      code += `  ${e.source} -->|${label}| ${e.target}\n`
    }
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [currentNodes, flowEdges, direction])

  const getNodePos = (nodeId: string) => {
    const n = layout.nodes.find((n) => n.id === nodeId)
    return n ? { x: n.x, y: n.y } : null
  }

  const handleNodeClick = (node: GraphNode, event: React.MouseEvent) => {
    if (node.type === "overflow") return
    const svgRect = svgRef.current?.getBoundingClientRect()
    if (!svgRect) return

    // Position popover near the click but within bounds
    const x = event.clientX - svgRect.left + 10
    const y = event.clientY - svgRect.top + 10

    setSelectedNode({ node, x, y })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Architecture Diagram</h1>
          <p className="text-sm text-muted-foreground">
            {isDemo ? "Demo data — run a scan to see your real architecture" : `${currentNodes.length} components, ${flowEdges.length} connections`}
          </p>
        </div>
      </div>

      {isDemo && (
        <div className="flex items-center gap-2 rounded-lg border border-info/30 bg-info/10 p-3">
          <Info className="h-4 w-4 text-info" />
          <p className="text-sm text-info">
            Showing demo data. Run <code className="rounded bg-info/20 px-1">navgator scan</code> to visualize your project.
          </p>
        </div>
      )}

      {/* Hosting Groups Summary */}
      {hostingGroups.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {hostingGroups.map((group) => (
            <div key={group.host.id} className="flex items-center gap-2 rounded-lg border border-info/20 bg-info/5 px-3 py-1.5">
              <Server className="h-3.5 w-3.5 text-info" />
              <span className="text-xs font-medium text-foreground">{group.host.name}</span>
              <span className="text-xs text-muted-foreground">hosts</span>
              {group.hosted.map((h) => (
                <Badge key={h.id} variant="outline" className="text-xs">{h.name}</Badge>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}>
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="w-12 text-center text-sm text-muted-foreground">{Math.round(zoom * 100)}%</span>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setZoom((z) => Math.min(2, z + 0.1))}>
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setZoom(1)}>
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>

        <Select value={direction} onValueChange={(v) => setDirection(v as "TB" | "LR")}>
          <SelectTrigger className="w-32 bg-card">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="TB">Top to Bottom</SelectItem>
            <SelectItem value="LR">Left to Right</SelectItem>
          </SelectContent>
        </Select>

        <Button
          variant={showFlowArrows ? "default" : "outline"}
          size="sm"
          className="gap-2"
          onClick={() => setShowFlowArrows(!showFlowArrows)}
        >
          <ArrowRight className="h-4 w-4" />
          Flow Arrows
        </Button>

        <div className="flex-1" />

        <Button variant="outline" size="sm" className="gap-2 bg-transparent" onClick={handleCopy}>
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied" : "Copy Mermaid"}
        </Button>
      </div>

      {/* Diagram */}
      <Card className="bg-card overflow-hidden">
        <CardContent className="p-0">
          <div className="relative overflow-auto bg-background/50" style={{ minHeight: 400 }}>
            {isLoading ? (
              <div className="flex h-96 items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <svg
                  ref={svgRef}
                  width={layout.svgWidth * zoom}
                  height={layout.svgHeight * zoom}
                  className="mx-auto"
                >
                  <g transform={`scale(${zoom})`}>
                    {/* Layer backgrounds */}
                    {layout.layers.map((layer) => (
                      <g key={layer.id}>
                        <rect
                          x={layer.x}
                          y={layer.y}
                          width={layer.width}
                          height={layer.height}
                          rx={8}
                          className="fill-secondary/30 stroke-border/50"
                          strokeWidth={1}
                          strokeDasharray="4 2"
                        />
                        <text
                          x={layer.x + 12}
                          y={layer.y + 18}
                          className="fill-muted-foreground font-medium uppercase tracking-wider"
                          style={{ fontSize: 10 }}
                        >
                          {layer.label}
                        </text>
                      </g>
                    ))}

                    {/* Hosting group outlines */}
                    {hostingGroups.map((group) => {
                      const hostPos = layout.nodes.find((n) => n.id === group.host.id)
                      const hostedPositions = group.hosted
                        .map((h) => layout.nodes.find((n) => n.id === h.id))
                        .filter(Boolean)

                      if (!hostPos || hostedPositions.length === 0) return null

                      const allPositions = [hostPos, ...hostedPositions]
                      const minX = Math.min(...allPositions.map((p) => p!.x)) - 8
                      const minY = Math.min(...allPositions.map((p) => p!.y)) - 8
                      const maxX = Math.max(...allPositions.map((p) => p!.x)) + 118
                      const maxY = Math.max(...allPositions.map((p) => p!.y)) + 48

                      return (
                        <rect
                          key={`host-${group.host.id}`}
                          x={minX}
                          y={minY}
                          width={maxX - minX}
                          height={maxY - minY}
                          rx={10}
                          className="fill-none stroke-info/40"
                          strokeWidth={2}
                          strokeDasharray="6 3"
                        />
                      )
                    })}

                    {/* Flow Edges */}
                    {showFlowArrows && flowEdges.map((edge, idx) => {
                      const from = getNodePos(edge.source)
                      const to = getNodePos(edge.target)
                      if (!from || !to) return null

                      const x1 = from.x + 55
                      const y1 = from.y + 20
                      const x2 = to.x + 55
                      const y2 = to.y + 20

                      // Use curved path for better readability
                      const midY = (y1 + y2) / 2
                      const path = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`

                      return (
                        <g key={idx}>
                          <path
                            d={path}
                            className="stroke-border"
                            fill="none"
                            strokeWidth={1.5}
                            markerEnd="url(#arrowhead)"
                          />
                          {edge.label && (
                            <text
                              x={(x1 + x2) / 2}
                              y={midY - 4}
                              textAnchor="middle"
                              className="fill-muted-foreground"
                              style={{ fontSize: 9 }}
                            >
                              {edge.label}
                            </text>
                          )}
                        </g>
                      )
                    })}

                    <defs>
                      <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                        <polygon points="0 0, 10 3.5, 0 7" className="fill-border" />
                      </marker>
                    </defs>

                    {/* Nodes */}
                    {layout.nodes.map((node) => {
                      const colors = typeColors[node.type] || typeColors.service || { bg: "fill-secondary", border: "stroke-border", text: "fill-foreground" }
                      const isHighlighted = selectedComponent?.toLowerCase() === node.label.toLowerCase()
                      const isSelected = selectedNode?.node.id === node.id
                      const hasHosting = node.node.hosts && node.node.hosts.length > 0

                      if (node.type === "overflow") {
                        return (
                          <g key={node.id}>
                            <text x={node.x + 55} y={node.y + 24} textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 11 }}>
                              {node.label}
                            </text>
                          </g>
                        )
                      }

                      return (
                        <g
                          key={node.id}
                          className="cursor-pointer"
                          onClick={(e) => handleNodeClick(node.node, e)}
                        >
                          <rect
                            x={node.x}
                            y={node.y}
                            width={110}
                            height={40}
                            rx={6}
                            className={`${colors.bg} ${colors.border} ${
                              isSelected ? "stroke-primary stroke-[2.5]" :
                              isHighlighted ? "stroke-primary stroke-2" : "stroke-1"
                            }`}
                          />
                          {/* Hosting indicator */}
                          {hasHosting && (
                            <circle
                              cx={node.x + 104}
                              cy={node.y + 6}
                              r={5}
                              className="fill-info stroke-card"
                              strokeWidth={1.5}
                            />
                          )}
                          <text
                            x={node.x + 55}
                            y={node.y + 24}
                            textAnchor="middle"
                            className={`${colors.text} font-medium`}
                            style={{ fontSize: 11 }}
                          >
                            {node.label.length > 14 ? node.label.slice(0, 12) + "…" : node.label}
                          </text>
                        </g>
                      )
                    })}
                  </g>
                </svg>

                {/* Node Detail Popover */}
                {selectedNode && (
                  <NodeDetail
                    node={selectedNode.node}
                    allNodes={currentNodes}
                    edges={currentEdges}
                    position={{ x: selectedNode.x, y: selectedNode.y }}
                    onClose={() => setSelectedNode(null)}
                  />
                )}
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Legend */}
      <Card className="bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Legend</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            {Object.entries(typeColors).map(([type, colors]) => (
              <div key={type} className="flex items-center gap-2">
                <div
                  className={`h-4 w-4 rounded border ${colors.bg.replace("fill-", "bg-")} ${colors.border.replace("stroke-", "border-")}`}
                />
                <span className="text-sm capitalize text-muted-foreground">{type}</span>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 rounded border-2 border-dashed border-info/40" />
              <span className="text-sm text-muted-foreground">Hosting group</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
