"use client"

import { useState } from "react"
import {
  AlertCircle,
  CheckCircle2,
  Database,
  HeartPulse,
  Info,
  Loader2,
  RefreshCw,
  Trash2,
  TrendingUp,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useRegistryHealth } from "@/lib/hooks"
import type { RegistryHealthCleanupResult } from "@/lib/types"

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown size"
  if (bytes < 1024) return `${bytes} B`
  const units = ["KB", "MB", "GB"]
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`
}

function formatEventTime(value: number | string | null): string {
  if (value === null || value === undefined) return "never"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "unknown"
  return date.toLocaleString()
}

// Panel body shows counts and basenames only; full filesystem paths stay in
// the CLI (see chunk spec design constraints).
function basename(fullPath: string): string {
  const parts = fullPath.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || fullPath
}

export function RegistryHealthPanel() {
  const { data, isLoading, error, refresh, cleanup, isCleaning, cleanupError } = useRegistryHealth()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [cleanupResult, setCleanupResult] = useState<RegistryHealthCleanupResult | null>(null)

  const handleCleanup = async () => {
    setCleanupResult(null)
    const result = await cleanup()
    if (result) {
      setCleanupResult(result)
    }
  }

  if (isLoading && !data) {
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
          <h1 className="text-2xl font-semibold text-foreground">Registry Health</h1>
          <p className="text-sm text-muted-foreground">
            Project registry, journal, and gator-memory store diagnostics
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={isLoading}>
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

      {!error && data && (
        <>
          {/* Verdict */}
          {data.verdict === "healthy" ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary">
                <CheckCircle2 className="h-6 w-6 text-green-600" />
              </div>
              <p className="mt-4 text-sm font-medium text-foreground">Registry is healthy</p>
              <p className="mt-1 text-xs text-muted-foreground">
                No action needed.
              </p>
            </div>
          ) : (
            <Card className="bg-card">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base font-medium">
                  <HeartPulse className="h-4 w-4 text-amber-600" />
                  <span className="text-amber-600">Attention needed</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="divide-y divide-border">
                  {data.findings.map((finding, idx) => (
                    <div key={`${finding.code}-${idx}`} className="py-3 first:pt-0 last:pb-0">
                      <p
                        className={`text-sm font-medium ${
                          finding.severity === "warn" ? "text-amber-600" : "text-blue-600"
                        }`}
                      >
                        {finding.code.replace(/-/g, " ")}
                      </p>
                      <p className="mt-0.5 text-sm text-muted-foreground">{finding.message}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Registry group */}
          <Card className="bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base font-medium">
                <Database className="h-4 w-4 text-muted-foreground" />
                Registry
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="divide-y divide-border">
                <div className="flex items-center justify-between py-2 first:pt-0">
                  <span className="text-sm text-muted-foreground">Entries</span>
                  <span className="text-sm font-medium text-foreground">{data.registry.entries}</span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-muted-foreground">Tmp-rooted</span>
                  <span className="text-sm font-medium text-foreground">{data.registry.tmpRooted}</span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-muted-foreground">Missing</span>
                  <span className="text-sm font-medium text-foreground">{data.registry.missing}</span>
                </div>
                <div className="flex items-center justify-between py-2 last:pb-0">
                  <span className="text-sm text-muted-foreground">Prunable</span>
                  <span
                    className={`text-sm font-medium ${
                      data.registry.prunable > 0 ? "text-amber-600" : "text-foreground"
                    }`}
                  >
                    {data.registry.prunable}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Growth (journal) */}
          <Card className="bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base font-medium">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                Registration growth
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.journal.records === 0 ? (
                <p className="text-sm text-muted-foreground">
                  The journal has no data yet.
                </p>
              ) : (
                <div>
                  <p className="text-sm text-foreground">
                    {data.journal.insufficientWindow ? (
                      <>
                        Not enough retained journal history to estimate a daily rate
                      </>
                    ) : (
                      <>
                        {data.journal.estimated ? "≈" : ""}
                        {data.journal.registersPerDay.toFixed(1)} new entries/day, estimated over
                        the last {data.journal.windowDays.toFixed(1)} days of retained journal
                      </>
                    )}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {data.journal.registersInWindow} registrations in window
                    {data.journal.conflicts > 0 && ` · ${data.journal.conflicts} conflicts`}
                    {data.journal.degradedWrites > 0 &&
                      ` · ${data.journal.degradedWrites} degraded writes`}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Memory store */}
          <Card className="bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base font-medium">
                <Info className="h-4 w-4 text-muted-foreground" />
                Gator memory
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!data.memory.exists ? (
                <p className="text-sm text-muted-foreground">
                  No memory store yet — it's created on first scan.
                </p>
              ) : (
                <div className="divide-y divide-border">
                  <div className="flex items-center justify-between py-2 first:pt-0">
                    <span className="text-sm text-muted-foreground">Projects tracked</span>
                    <span className="text-sm font-medium text-foreground">{data.memory.projects}</span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-sm text-muted-foreground">Orphaned records</span>
                    <span
                      className={`text-sm font-medium ${
                        data.memory.orphaned > 0 ? "text-amber-600" : "text-foreground"
                      }`}
                    >
                      {data.memory.orphaned}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-sm text-muted-foreground">Events</span>
                    <span className="text-sm font-medium text-foreground">{data.memory.events}</span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-sm text-muted-foreground">Size</span>
                    <span className="text-sm font-medium text-foreground">
                      {formatBytes(data.memory.bytes)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2 last:pb-0">
                    <span className="text-sm text-muted-foreground">Last event</span>
                    <span className="text-xs text-muted-foreground">
                      {formatEventTime(data.memory.lastEventAt)}
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Mirror */}
          <Card className="bg-card">
            <CardContent className="py-4">
              {!data.mirror.enabled ? (
                <p className="text-sm text-muted-foreground">Mirror is off.</p>
              ) : data.mirror.targetExists ? (
                <p className="text-sm text-foreground">Mirror enabled — target found.</p>
              ) : (
                <p className="text-sm text-amber-600">Mirror enabled — target missing.</p>
              )}
            </CardContent>
          </Card>

          {/* Cleanup */}
          {data.registry.prunable > 0 && (
            <Card className="bg-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-medium">Clean up registry</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Removes {data.registry.prunable} entr{data.registry.prunable !== 1 ? "ies" : "y"} that
                  are both tmp-rooted and missing on disk. A timestamped backup is written first.
                </p>
                {cleanupError && (
                  <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
                    <AlertCircle className="h-4 w-4 text-destructive" />
                    <p className="text-sm text-destructive">{cleanupError}</p>
                  </div>
                )}
                {cleanupResult && (
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-sm text-foreground">
                      Removed {cleanupResult.removedFromRegistry} registry entr
                      {cleanupResult.removedFromRegistry !== 1 ? "ies" : "y"} and{" "}
                      {cleanupResult.removedFromMemory} memory record
                      {cleanupResult.removedFromMemory !== 1 ? "s" : ""}.
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Backup written to {basename(cleanupResult.backupPath)}
                    </p>
                  </div>
                )}
                <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setConfirmOpen(true)}
                    disabled={isCleaning}
                  >
                    {isCleaning ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                    <span className="ml-2">Clean up prunable entries</span>
                  </Button>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Clean up {data.registry.prunable} registry entries?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This removes {data.registry.prunable} entr
                        {data.registry.prunable !== 1 ? "ies" : "y"} that are both tmp-rooted and
                        missing on disk, along with any associated orphaned gator-memory records.
                        A timestamped backup is written before anything is removed.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleCleanup}>Clean up</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
