"use client"

import { useState } from "react"
import {
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FileQuestion,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { useCoverage } from "@/lib/hooks"
import type { CoverageGap } from "@/lib/types"

const gapTypeConfig: Record<
  string,
  { label: string; icon: typeof AlertTriangle; color: string }
> = {
  "unmapped-file": {
    label: "Unmapped Files",
    icon: FileQuestion,
    color: "text-amber-600",
  },
  "low-confidence-connection": {
    label: "Low Confidence Connections",
    icon: AlertTriangle,
    color: "text-amber-600",
  },
  "zero-consumers": {
    label: "Zero Consumers",
    icon: AlertCircle,
    color: "text-red-600",
  },
  "no-outgoing": {
    label: "No Outgoing Connections",
    icon: AlertCircle,
    color: "text-blue-600",
  },
}

const INITIAL_SHOW = 20

export function CoveragePanel() {
  const { coverage, isLoading, error, refresh } = useCoverage({ autoFetch: true })
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [showAll, setShowAll] = useState<Set<string>>(new Set())

  const toggleGroup = (type: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  const toggleShowAll = (type: string) => {
    setShowAll((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // Group gaps by type
  const gapsByType = (coverage?.gaps || []).reduce<Record<string, CoverageGap[]>>(
    (acc, gap) => {
      if (!acc[gap.type]) acc[gap.type] = []
      acc[gap.type].push(gap)
      return acc
    },
    {}
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            Architecture Coverage
          </h1>
          <p className="text-sm text-muted-foreground">
            {coverage
              ? `${coverage.component_coverage.coverage_percent}% file coverage, ${coverage.connection_coverage.total_connections} connections tracked`
              : "Analyzing architecture coverage"}
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

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
          <AlertCircle className="h-4 w-4 text-destructive" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {!coverage && !error && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary">
            <ShieldCheck className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="mt-4 text-sm font-medium text-foreground">
            No coverage data
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Run <code className="rounded bg-secondary px-1">navgator scan</code>{" "}
            to analyze your project.
          </p>
        </div>
      )}

      {coverage && (
        <>
          {/* Summary cards */}
          <div className="grid gap-4 sm:grid-cols-3">
            <Card className="bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  File Coverage
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold text-foreground">
                  {coverage.component_coverage.coverage_percent}%
                </div>
                <Progress
                  value={coverage.component_coverage.coverage_percent}
                  className="mt-2 h-2"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {coverage.component_coverage.files_mapped_to_components} /{" "}
                  {coverage.component_coverage.total_files_in_project} files
                </p>
              </CardContent>
            </Card>

            <Card className="bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Connection Confidence
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold text-foreground">
                  {Math.round(coverage.overall_confidence * 100)}%
                </div>
                <div className="mt-2 flex gap-4 text-xs">
                  <span className="text-green-600">
                    {coverage.connection_coverage.by_confidence.high} high
                  </span>
                  <span className="text-amber-600">
                    {coverage.connection_coverage.by_confidence.medium} med
                  </span>
                  <span className="text-red-600">
                    {coverage.connection_coverage.by_confidence.low} low
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Classification
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold text-foreground">
                  {Object.keys(coverage.connection_coverage.by_classification).length}
                </div>
                <div className="mt-2 space-y-1">
                  {Object.entries(coverage.connection_coverage.by_classification)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 4)
                    .map(([cls, count]) => (
                      <div
                        key={cls}
                        className="flex items-center justify-between text-xs"
                      >
                        <span className="text-muted-foreground">{cls}</span>
                        <span className="font-medium text-foreground">
                          {count}
                        </span>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Gaps */}
          {Object.keys(gapsByType).length > 0 && (
            <div className="space-y-3">
              <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Gaps ({coverage.gaps.length})
              </h2>
              {Object.entries(gapsByType).map(([type, gaps]) => {
                const config = gapTypeConfig[type] || {
                  label: type,
                  icon: AlertTriangle,
                  color: "text-muted-foreground",
                }
                const Icon = config.icon
                const isExpanded = expandedGroups.has(type)
                const isShowingAll = showAll.has(type)
                const displayed = isShowingAll
                  ? gaps
                  : gaps.slice(0, INITIAL_SHOW)

                return (
                  <Card key={type} className="bg-card">
                    <button
                      className="flex w-full items-center gap-2 p-4 text-left"
                      onClick={() => toggleGroup(type)}
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                      <Icon className={`h-4 w-4 ${config.color}`} />
                      <span className="text-sm font-medium text-foreground">
                        {config.label}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        ({gaps.length})
                      </span>
                    </button>
                    {isExpanded && (
                      <CardContent className="pt-0">
                        <div className="divide-y divide-border">
                          {displayed.map((gap, idx) => (
                            <div
                              key={`${gap.target}-${idx}`}
                              className="py-2 first:pt-0 last:pb-0"
                            >
                              <p className="text-sm text-foreground font-mono">
                                {gap.target}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {gap.message}
                              </p>
                            </div>
                          ))}
                        </div>
                        {gaps.length > INITIAL_SHOW && (
                          <button
                            onClick={() => toggleShowAll(type)}
                            className="mt-2 text-xs text-primary hover:underline"
                          >
                            {isShowingAll
                              ? "Show less"
                              : `Show ${gaps.length - INITIAL_SHOW} more`}
                          </button>
                        )}
                      </CardContent>
                    )}
                  </Card>
                )
              })}
            </div>
          )}

          {/* No gaps */}
          {coverage.gaps.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary">
                <ShieldCheck className="h-6 w-6 text-green-600" />
              </div>
              <p className="mt-4 text-sm font-medium text-foreground">
                No coverage gaps
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                All components are well-connected.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
