"use client"

import { useState } from "react"
import {
  Target,
  ArrowDownToLine,
  ArrowUpFromLine,
  FileCode,
  Code2,
  AlertTriangle,
  CheckCircle2,
  Search,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface ImpactAnalysisProps {
  componentName: string | null
  onSelectComponent: (name: string) => void
}

const componentData: Record<
  string,
  {
    type: string
    layer: string
    purpose: string
    incoming: Array<{
      file: string
      symbol: string
      line: number
      code: string
    }>
    outgoing: Array<{
      target: string
      symbol: string
      line: number
      code: string
    }>
  }
> = {
  Stripe: {
    type: "service",
    layer: "external",
    purpose: "Payment processing",
    incoming: [
      {
        file: "src/api/payments.ts",
        symbol: "createPaymentIntent",
        line: 45,
        code: "await stripe.paymentIntents.create({...})",
      },
      {
        file: "src/api/subscriptions.ts",
        symbol: "createSubscription",
        line: 23,
        code: "await stripe.subscriptions.create({...})",
      },
      {
        file: "src/webhooks/stripe.ts",
        symbol: "handleWebhook",
        line: 12,
        code: "stripe.webhooks.constructEvent(...)",
      },
    ],
    outgoing: [],
  },
  PostgreSQL: {
    type: "database",
    layer: "data",
    purpose: "Primary data store",
    incoming: [
      {
        file: "src/api/users.ts",
        symbol: "getUser",
        line: 15,
        code: "prisma.user.findUnique({...})",
      },
      {
        file: "src/api/users.ts",
        symbol: "createUser",
        line: 32,
        code: "prisma.user.create({...})",
      },
      {
        file: "src/api/posts.ts",
        symbol: "getPosts",
        line: 8,
        code: "prisma.post.findMany({...})",
      },
      {
        file: "src/api/posts.ts",
        symbol: "createPost",
        line: 25,
        code: "prisma.post.create({...})",
      },
      {
        file: "src/api/comments.ts",
        symbol: "getComments",
        line: 12,
        code: "prisma.comment.findMany({...})",
      },
      {
        file: "src/api/auth.ts",
        symbol: "validateSession",
        line: 18,
        code: "prisma.session.findUnique({...})",
      },
      {
        file: "src/jobs/cleanup.ts",
        symbol: "cleanupExpired",
        line: 8,
        code: "prisma.session.deleteMany({...})",
      },
      {
        file: "src/api/analytics.ts",
        symbol: "trackEvent",
        line: 22,
        code: "prisma.event.create({...})",
      },
    ],
    outgoing: [],
  },
  BullMQ: {
    type: "queue",
    layer: "backend",
    purpose: "Job queue processing",
    incoming: [
      {
        file: "src/api/payments.ts",
        symbol: "queuePaymentJob",
        line: 78,
        code: "paymentQueue.add('process', {...})",
      },
      {
        file: "src/api/notifications.ts",
        symbol: "queueNotification",
        line: 15,
        code: "notificationQueue.add('send', {...})",
      },
      {
        file: "src/api/reports.ts",
        symbol: "scheduleReport",
        line: 42,
        code: "reportQueue.add('generate', {...})",
      },
    ],
    outgoing: [
      {
        target: "SendGrid",
        symbol: "processEmailJob",
        line: 25,
        code: "sgMail.send({...})",
      },
      {
        target: "Stripe",
        symbol: "processPaymentJob",
        line: 45,
        code: "stripe.charges.create({...})",
      },
    ],
  },
  "Next.js": {
    type: "framework",
    layer: "frontend",
    purpose: "React framework",
    incoming: [],
    outgoing: [
      {
        target: "src/api/users.ts",
        symbol: "getServerSideProps",
        line: 12,
        code: "fetch('/api/users')",
      },
      {
        target: "src/api/posts.ts",
        symbol: "getStaticProps",
        line: 28,
        code: "fetch('/api/posts')",
      },
    ],
  },
  Redis: {
    type: "database",
    layer: "data",
    purpose: "Caching layer",
    incoming: [
      {
        file: "src/lib/cache.ts",
        symbol: "getCached",
        line: 12,
        code: "redis.get(key)",
      },
      {
        file: "src/lib/cache.ts",
        symbol: "setCached",
        line: 22,
        code: "redis.set(key, value)",
      },
      {
        file: "src/api/rate-limit.ts",
        symbol: "checkLimit",
        line: 8,
        code: "redis.incr(`rate:${ip}`)",
      },
      {
        file: "src/api/sessions.ts",
        symbol: "storeSession",
        line: 18,
        code: "redis.setex(`session:${id}`, ...)",
      },
    ],
    outgoing: [],
  },
}

const allComponents = [
  "Stripe",
  "PostgreSQL",
  "BullMQ",
  "Next.js",
  "Redis",
  "OpenAI",
  "Anthropic",
  "SendGrid",
  "Vercel",
]

export function ImpactAnalysis({ componentName, onSelectComponent }: ImpactAnalysisProps) {
  const [search, setSearch] = useState("")

  const data = componentName ? componentData[componentName] : null

  const filteredComponents = allComponents.filter((c) =>
    c.toLowerCase().includes(search.toLowerCase())
  )

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

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredComponents.map((name) => (
            <button
              key={name}
              onClick={() => onSelectComponent(name)}
              className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:bg-secondary"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <Target className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="font-medium text-card-foreground">{name}</p>
                <p className="text-xs text-muted-foreground">
                  {componentData[name]?.type || "component"} · {componentData[name]?.layer || "unknown"}
                </p>
              </div>
            </button>
          ))}
        </div>
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
            {data.type} · {data.layer} · {data.purpose}
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
                    <span className="font-mono text-sm text-foreground">{conn.file}</span>
                    <span className="text-xs text-muted-foreground">:{conn.line}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <Code2 className="h-3.5 w-3.5" />
                    <span className="font-medium text-foreground">{conn.symbol}</span>
                  </div>
                  <pre className="mt-2 rounded bg-background p-2 font-mono text-xs text-muted-foreground overflow-x-auto">
                    {conn.code}
                  </pre>
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
                  onClick={() => onSelectComponent(conn.target)}
                  className="w-full rounded-lg border border-border bg-secondary/30 p-3 text-left transition-colors hover:bg-secondary/50"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="bg-primary/10 text-primary">
                      {conn.target}
                    </Badge>
                    <span className="text-xs text-muted-foreground">:{conn.line}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <Code2 className="h-3.5 w-3.5" />
                    <span className="font-medium text-foreground">{conn.symbol}</span>
                  </div>
                  <pre className="mt-2 rounded bg-background p-2 font-mono text-xs text-muted-foreground overflow-x-auto">
                    {conn.code}
                  </pre>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
