/**
 * Hook for fetching and managing project status data
 */

import { useState, useEffect, useCallback } from "react";
import type { ProjectStatus, StatusApiResponse } from "../types";

interface UseStatusResult {
  status: ProjectStatus | null;
  isLoading: boolean;
  error: string | null;
  source: "scan" | "cache" | "mock" | null;
  refresh: () => Promise<void>;
}

interface UseStatusOptions {
  autoFetch?: boolean;
  projectPath?: string;
}

export function useStatus(options: UseStatusOptions = {}): UseStatusResult {
  const { autoFetch = true, projectPath } = options;

  const [status, setStatus] = useState<ProjectStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"scan" | "cache" | "mock" | null>(null);

  const fetchData = useCallback(
    async (forceRefresh = false) => {
      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        if (forceRefresh) params.set("refresh", "true");
        if (projectPath) params.set("path", projectPath);

        const response = await fetch(`/api/status?${params.toString()}`);
        const result: StatusApiResponse = await response.json();

        if (result.success && result.data) {
          setStatus(result.data);
          setSource(result.source);
          if (result.error) {
            setError(result.error);
          }
        } else {
          setError(result.error || "Failed to fetch status");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error");
      } finally {
        setIsLoading(false);
      }
    },
    [projectPath]
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
    status,
    isLoading,
    error,
    source,
    refresh,
  };
}
