"use client"

import { useState, useEffect } from "react"
import {
  AlertTriangle,
  AlertCircle,
  Info,
  Loader2,
  RefreshCw,
  Shield,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import type { RuleViolation, RulesApiResponse } from "@/lib/types"

const severityConfig = {
  error: { icon: AlertCircle, color: "text-red-600", label: "ERROR" },
  warning: { icon: AlertTriangle, color: "text-amber-600", label: "WARN" },
  info: { icon: Info, color: "text-blue-600", label: "INFO" },
}

const severityOrder: Array<"error" | "warning" | "info"> = ["error", "warning", "info"]

export function RulesPanel() {
  const [violations, setViolations] = useState<RuleViolation[]>([])
  const [summary, setSummary] = useState<{ total: number; errors: number; warnings: number; info: number }>({ total: 0, errors: 0, warnings: 0, info: 0 })
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchRules = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/rules")
      const json: RulesApiResponse = await res.json()
      if (json.success && json.data) {
        setViolations(json.data.violations)
        setSummary(json.data.summary)
      } else {
        setError(json.error || "Failed to load rules")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch rules")
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchRules()
  }, [])

  // Group violations by severity
  const grouped = severityOrder.reduce<Record<string, RuleViolation[]>>((acc, sev) => {
    const items = violations.filter((v) => v.severity === sev)
    if (items.length > 0) acc[sev] = items
    return acc
  }, {})

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Architecture Rules</h1>
          <p className="text-sm text-muted-foreground">
            {summary.total === 0
              ? "No rule violations found"
              : `${summary.total} violation${summary.total !== 1 ? "s" : ""} found`}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchRules} disabled={isLoading}>
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

      {/* Summary stats */}
      {summary.total > 0 && (
        <div className="flex gap-6 text-sm">
          {summary.errors > 0 && (
            <span className="text-red-600 font-medium">{summary.errors} error{summary.errors !== 1 ? "s" : ""}</span>
          )}
          {summary.warnings > 0 && (
            <span className="text-amber-600 font-medium">{summary.warnings} warning{summary.warnings !== 1 ? "s" : ""}</span>
          )}
          {summary.info > 0 && (
            <span className="text-blue-600 font-medium">{summary.info} info</span>
          )}
        </div>
      )}

      {/* Violations grouped by severity */}
      {Object.entries(grouped).map(([severity, items]) => {
        const config = severityConfig[severity as keyof typeof severityConfig]
        const SevIcon = config.icon

        return (
          <Card key={severity} className="bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base font-medium">
                <SevIcon className={`h-4 w-4 ${config.color}`} />
                <span className={config.color}>{config.label}</span>
                <span className="text-muted-foreground font-normal">({items.length})</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="divide-y divide-border">
                {items.map((v, idx) => (
                  <div key={`${v.rule_id}-${idx}`} className="py-3 first:pt-0 last:pb-0">
                    <p className="text-sm font-medium text-foreground">{v.rule_id.replace(/-/g, " ")}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">{v.message}</p>
                    {v.suggestion && (
                      <p className="mt-0.5 text-xs text-muted-foreground/70">{v.suggestion}</p>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )
      })}

      {/* Empty state */}
      {summary.total === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary">
            <Shield className="h-6 w-6 text-green-600" />
          </div>
          <p className="mt-4 text-sm font-medium text-foreground">All clear</p>
          <p className="mt-1 text-xs text-muted-foreground">
            No architecture rule violations detected.
          </p>
        </div>
      )}
    </div>
  )
}
