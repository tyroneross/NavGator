/**
 * Hook for fetching and managing component data
 */

import { useState, useEffect, useCallback } from "react";
import type { Component, ComponentsSummary, ComponentsApiResponse } from "../types";

interface UseComponentsResult {
  components: Component[];
  summary: ComponentsSummary | null;
  isLoading: boolean;
  error: string | null;
  source: "scan" | "cache" | "mock" | null;
  refresh: () => Promise<void>;
}

interface UseComponentsOptions {
  demoMode?: boolean;
  autoFetch?: boolean;
  projectPath?: string;
}

export function useComponents(options: UseComponentsOptions = {}): UseComponentsResult {
  const { demoMode = false, autoFetch = true, projectPath } = options;

  const [components, setComponents] = useState<Component[]>([]);
  const [summary, setSummary] = useState<ComponentsSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"scan" | "cache" | "mock" | null>(null);

  const fetchData = useCallback(
    async (forceRefresh = false) => {
      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        if (demoMode) params.set("demo", "true");
        if (forceRefresh) params.set("refresh", "true");
        if (projectPath) params.set("path", projectPath);

        const response = await fetch(`/api/components?${params.toString()}`);
        const result: ComponentsApiResponse = await response.json();

        if (result.success && result.data) {
          setComponents(result.data.components);
          setSummary(result.data.summary);
          setSource(result.source);
        } else {
          setError(result.error || "Failed to fetch data");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error");
      } finally {
        setIsLoading(false);
      }
    },
    [demoMode, projectPath]
  );

  const refresh = useCallback(async () => {
    await fetchData(true);
  }, [fetchData]);

  useEffect(() => {
    if (autoFetch) {
      fetchData();
    }
  }, [autoFetch, fetchData]);

  return {
    components,
    summary,
    isLoading,
    error,
    source,
    refresh,
  };
}
