import { describe, expect, it } from "vitest"
import { componentName, connectionsForComponent, pageSlice, projectApiUrl, projectHealth } from "../../web/lib/project-data.js"

describe("project dashboard data helpers", () => {
  it("scopes requests to the selected project", () => {
    expect(projectApiUrl("/api/rules", "/repo/a", { refresh: "true" }))
      .toBe("/api/rules?refresh=true&path=%2Frepo%2Fa")
  })

  it("joins connections using exact component ids", () => {
    const connections = [
      { id: "1", from: "a", fromComponent: "COMP_A", to: "b", toComponent: "COMP_B", type: "imports", symbol: "", line: 1, code: "" },
      { id: "2", from: "x", fromComponent: "COMP_A_EXTRA", to: "b", toComponent: "COMP_B", type: "imports", symbol: "", line: 1, code: "" },
    ] as const
    const result = connectionsForComponent("COMP_A", [...connections])
    expect(result.outgoing.map((connection) => connection.id)).toEqual(["1"])
    expect(result.incoming).toEqual([])
  })

  it("renders endpoint names from ids", () => {
    const components = [{ id: "COMP_A", name: "Scanner" }] as never[]
    expect(componentName("COMP_A", components, "src/scanner.ts")).toBe("Scanner")
  })

  it("does not claim good health before rules load", () => {
    const status = { stats: { total_components: 1, vulnerable_count: 0 } } as never
    expect(projectHealth(status, null)).toEqual({ label: "Checking", status: "checking" })
    expect(projectHealth(status, { total: 1, errors: 1, warnings: 0, info: 0 }).label).toBe("Issues")
  })

  it("bounds large connection lists", () => {
    expect(pageSlice(Array.from({ length: 205 }, (_, index) => index), 2, 100))
      .toEqual(Array.from({ length: 100 }, (_, index) => index + 100))
  })
})
