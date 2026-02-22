/**
 * Hook for tracing dataflow through architecture
 */

import { useState, useEffect, useCallback } from "react";
import type { TraceResult, TraceApiResponse } from "../types";
import { useActiveProject } from "../project-context";

interface UseTraceResult {
  trace: TraceResult | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

interface UseTraceOptions {
  component?: string;
  direction?: "forward" | "backward" | "both";
  maxDepth?: number;
  filter?: string;
  autoFetch?: boolean;
  projectPath?: string;
}

export function useTrace(options: UseTraceOptions = {}): UseTraceResult {
  const {
    component,
    direction = "both",
    maxDepth = 5,
    filter,
    autoFetch = false,
    projectPath: explicitPath,
  } = options;
  const { activeProjectPath } = useActiveProject();
  const projectPath = explicitPath || activeProjectPath || undefined;

  const [trace, setTrace] = useState<TraceResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(
    async () => {
      if (!component) return;

      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        params.set("component", component);
        params.set("direction", direction);
        params.set("maxDepth", String(maxDepth));
        if (filter) params.set("filter", filter);
        if (projectPath) params.set("path", projectPath);

        const response = await fetch(`/api/trace?${params.toString()}`);
        const result: TraceApiResponse = await response.json();

        if (result.success && result.data) {
          setTrace(result.data);
        } else {
          setError(result.error || "Failed to trace dataflow");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error");
      } finally {
        setIsLoading(false);
      }
    },
    [component, direction, maxDepth, filter, projectPath]
  );

  const refresh = useCallback(async () => {
    await fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (autoFetch && component) {
      fetchData();
    }
  }, [autoFetch, component, fetchData]);

  return { trace, isLoading, error, refresh };
}
