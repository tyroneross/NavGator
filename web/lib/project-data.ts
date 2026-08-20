import type { Component, Connection, ProjectStatus } from "./types"

export interface RulesSummary {
  total: number
  errors: number
  warnings: number
  info: number
}

export function projectApiUrl(route: string, projectPath: string | null, params?: Record<string, string>): string {
  const query = new URLSearchParams(params)
  if (projectPath) query.set("path", projectPath)
  const suffix = query.toString()
  return suffix ? `${route}?${suffix}` : route
}

export function connectionsForComponent(componentId: string, connections: Connection[]) {
  return {
    incoming: connections.filter((connection) => connection.toComponent === componentId),
    outgoing: connections.filter((connection) => connection.fromComponent === componentId),
  }
}

export function componentName(componentId: string | undefined, components: Component[], fallback: string): string {
  if (!componentId) return fallback
  return components.find((component) => component.id === componentId)?.name || fallback
}

export function projectHealth(status: ProjectStatus | null, rules: RulesSummary | null) {
  if (!status || status.stats.total_components === 0) return { label: "No data", status: "warning" as const }
  if (!rules) return { label: "Checking", status: "checking" as const }
  if (status.stats.vulnerable_count > 0 || rules.errors > 0) return { label: "Issues", status: "warning" as const }
  if (rules.warnings > 0) return { label: "Warnings", status: "warning" as const }
  return { label: "Good", status: "success" as const }
}
