"use client"

import { useState, useCallback } from "react"
import {
  Download,
  Copy,
  Check,
  Maximize2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
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

interface DiagramViewProps {
  selectedComponent: string | null
}

// Layer groups with their bounding boxes
const layers = [
  { id: "frontend", label: "Frontend", y: 80, height: 100 },
  { id: "backend", label: "Backend", y: 200, height: 120 },
  { id: "data", label: "Data Layer", y: 340, height: 120 },
  { id: "external", label: "External Services", y: 480, height: 120 },
]

const nodes = [
  { id: "nextjs", label: "Next.js", type: "framework", x: 100, y: 110, layer: "frontend" },
  { id: "react", label: "React", type: "npm", x: 220, y: 110, layer: "frontend" },
  { id: "tailwind", label: "Tailwind", type: "npm", x: 340, y: 110, layer: "frontend" },
  
  { id: "payments", label: "payments.ts", type: "api", x: 80, y: 240, layer: "backend" },
  { id: "users", label: "users.ts", type: "api", x: 200, y: 240, layer: "backend" },
  { id: "posts", label: "posts.ts", type: "api", x: 320, y: 240, layer: "backend" },
  { id: "bullmq", label: "BullMQ", type: "queue", x: 440, y: 240, layer: "backend" },
  
  { id: "postgres", label: "PostgreSQL", type: "database", x: 140, y: 380, layer: "data" },
  { id: "redis", label: "Redis", type: "database", x: 280, y: 380, layer: "data" },
  { id: "prisma", label: "Prisma", type: "npm", x: 420, y: 380, layer: "data" },
  
  { id: "stripe", label: "Stripe", type: "service", x: 80, y: 520, layer: "external" },
  { id: "openai", label: "OpenAI", type: "service", x: 200, y: 520, layer: "external" },
  { id: "sendgrid", label: "SendGrid", type: "service", x: 320, y: 520, layer: "external" },
  { id: "s3", label: "AWS S3", type: "service", x: 440, y: 520, layer: "external" },
]

const edges = [
  { from: "nextjs", to: "payments", label: "API" },
  { from: "nextjs", to: "users", label: "API" },
  { from: "nextjs", to: "posts", label: "API" },
  { from: "payments", to: "prisma", label: "ORM" },
  { from: "payments", to: "stripe", label: "call" },
  { from: "payments", to: "bullmq", label: "queue" },
  { from: "users", to: "prisma", label: "ORM" },
  { from: "posts", to: "prisma", label: "ORM" },
  { from: "prisma", to: "postgres", label: "query" },
  { from: "bullmq", to: "sendgrid", label: "call" },
  { from: "bullmq", to: "redis", label: "queue" },
  { from: "users", to: "redis", label: "cache" },
  { from: "posts", to: "openai", label: "call" },
  { from: "posts", to: "s3", label: "upload" },
]

const typeColors: Record<string, { bg: string; border: string; text: string }> = {
  framework: { bg: "fill-chart-1/20", border: "stroke-chart-1", text: "fill-chart-1" },
  npm: { bg: "fill-chart-1/10", border: "stroke-chart-1/50", text: "fill-foreground" },
  api: { bg: "fill-secondary", border: "stroke-border", text: "fill-foreground" },
  database: { bg: "fill-chart-3/20", border: "stroke-chart-3", text: "fill-chart-3" },
  queue: { bg: "fill-chart-4/20", border: "stroke-chart-4", text: "fill-chart-4" },
  service: { bg: "fill-chart-2/20", border: "stroke-chart-2", text: "fill-chart-2" },
  layer: { bg: "fill-transparent", border: "stroke-transparent", text: "fill-muted-foreground" },
}

export function DiagramView({ selectedComponent }: DiagramViewProps) {
  const [copied, setCopied] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [direction, setDirection] = useState<"TB" | "LR">("TB")

  const handleCopy = useCallback(() => {
    const mermaid = generateMermaid()
    navigator.clipboard.writeText(mermaid)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [])

  const generateMermaid = () => {
    let code = `flowchart ${direction}\n`
    code += `  subgraph Frontend\n`
    code += `    nextjs[Next.js]\n`
    code += `    react[React]\n`
    code += `  end\n`
    code += `  subgraph Backend\n`
    code += `    payments[payments.ts]\n`
    code += `    users[users.ts]\n`
    code += `    posts[posts.ts]\n`
    code += `    bullmq[BullMQ]\n`
    code += `  end\n`
    code += `  subgraph Data\n`
    code += `    postgres[(PostgreSQL)]\n`
    code += `    redis[(Redis)]\n`
    code += `  end\n`
    code += `  subgraph External\n`
    code += `    stripe[Stripe]\n`
    code += `    openai[OpenAI]\n`
    code += `    sendgrid[SendGrid]\n`
    code += `  end\n\n`
    
    edges.forEach((edge) => {
      code += `  ${edge.from} -->|${edge.label}| ${edge.to}\n`
    })
    
    return code
  }

  const getNodePosition = (node: typeof nodes[0]) => {
    const baseX = direction === "TB" ? node.x : node.y
    const baseY = direction === "TB" ? node.y : node.x
    return { x: baseX * zoom, y: baseY * zoom }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Architecture Diagram</h1>
          <p className="text-sm text-muted-foreground">
            Visual representation of your project architecture
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="w-12 text-center text-sm text-muted-foreground">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => setZoom((z) => Math.min(2, z + 0.1))}
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => setZoom(1)}
          >
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

        <div className="flex-1" />

        <Button variant="outline" size="sm" className="gap-2 bg-transparent" onClick={handleCopy}>
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied" : "Copy Mermaid"}
        </Button>
        <Button variant="outline" size="sm" className="gap-2 bg-transparent">
          <Download className="h-4 w-4" />
          Export
        </Button>
      </div>

      {/* Diagram */}
      <Card className="bg-card overflow-hidden">
        <CardContent className="p-0">
          <div className="relative overflow-auto bg-background/50" style={{ height: 600 }}>
            <svg
              width={direction === "TB" ? 600 * zoom : 700 * zoom}
              height={direction === "TB" ? 680 * zoom : 600 * zoom}
              className="mx-auto"
            >
              {/* Layer group backgrounds with labels */}
              {layers.map((layer) => {
                const layerY = direction === "TB" ? layer.y * zoom : 40 * zoom
                const layerX = direction === "TB" ? 40 * zoom : layer.y * zoom
                const layerWidth = direction === "TB" ? 520 * zoom : layer.height * zoom
                const layerHeight = direction === "TB" ? layer.height * zoom : 520 * zoom
                
                return (
                  <g key={layer.id}>
                    {/* Layer background */}
                    <rect
                      x={layerX}
                      y={layerY}
                      width={layerWidth}
                      height={layerHeight}
                      rx={8 * zoom}
                      className="fill-secondary/30 stroke-border/50"
                      strokeWidth={1}
                      strokeDasharray="4 2"
                    />
                    {/* Layer label */}
                    <text
                      x={layerX + 12 * zoom}
                      y={layerY + 18 * zoom}
                      className="fill-muted-foreground font-medium uppercase tracking-wider"
                      style={{ fontSize: 10 * zoom }}
                    >
                      {layer.label}
                    </text>
                  </g>
                )
              })}

              {/* Edges */}
              {edges.map((edge, idx) => {
                const fromNode = nodes.find((n) => n.id === edge.from)
                const toNode = nodes.find((n) => n.id === edge.to)
                if (!fromNode || !toNode) return null

                const from = getNodePosition(fromNode)
                const to = getNodePosition(toNode)

                const midX = (from.x + 50 * zoom + to.x + 50 * zoom) / 2
                const midY = (from.y + 20 * zoom + to.y + 20 * zoom) / 2

                return (
                  <g key={idx}>
                    <line
                      x1={from.x + 50 * zoom}
                      y1={from.y + 20 * zoom}
                      x2={to.x + 50 * zoom}
                      y2={to.y + 20 * zoom}
                      className="stroke-border"
                      strokeWidth={1.5}
                      markerEnd="url(#arrowhead)"
                    />
                  </g>
                )
              })}

              {/* Arrow marker */}
              <defs>
                <marker
                  id="arrowhead"
                  markerWidth="10"
                  markerHeight="7"
                  refX="9"
                  refY="3.5"
                  orient="auto"
                >
                  <polygon
                    points="0 0, 10 3.5, 0 7"
                    className="fill-border"
                  />
                </marker>
              </defs>

              {/* Nodes */}
              {nodes.map((node) => {
                if (node.type === "layer") return null
                const pos = getNodePosition(node)
                const colors = typeColors[node.type] || typeColors.api
                const isHighlighted =
                  selectedComponent?.toLowerCase() === node.label.toLowerCase() ||
                  selectedComponent?.toLowerCase() === node.id

                return (
                  <g key={node.id}>
                    <rect
                      x={pos.x}
                      y={pos.y}
                      width={100 * zoom}
                      height={40 * zoom}
                      rx={6 * zoom}
                      className={`${colors.bg} ${colors.border} ${
                        isHighlighted ? "stroke-primary stroke-2" : "stroke-1"
                      }`}
                    />
                    <text
                      x={pos.x + 50 * zoom}
                      y={pos.y + 24 * zoom}
                      textAnchor="middle"
                      className={`${colors.text} text-xs font-medium`}
                      style={{ fontSize: 12 * zoom }}
                    >
                      {node.label}
                    </text>
                  </g>
                )
              })}
            </svg>
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
            {Object.entries(typeColors)
              .filter(([type]) => type !== "layer")
              .map(([type, colors]) => (
                <div key={type} className="flex items-center gap-2">
                  <div
                    className={`h-4 w-4 rounded border ${colors.bg.replace("fill-", "bg-")} ${colors.border.replace("stroke-", "border-")}`}
                  />
                  <span className="text-sm capitalize text-muted-foreground">{type}</span>
                </div>
              ))}
          </div>
        </CardContent>
      </Card>

      {/* Mermaid Code */}
      <Card className="bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-sm font-medium">
            Mermaid Code
            <Badge variant="secondary">Auto-generated</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-lg bg-background p-4 font-mono text-xs text-muted-foreground">
            {generateMermaid()}
          </pre>
        </CardContent>
      </Card>
    </div>
  )
}
