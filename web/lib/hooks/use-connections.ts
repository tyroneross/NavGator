/**
 * Hook for fetching and managing connection data
 */

import { useState, useEffect, useCallback } from "react";
import type { Connection, ConnectionsSummary, ConnectionsApiResponse } from "../types";
import { useActiveProject } from "../project-context";

interface UseConnectionsResult {
  connections: Connection[];
  summary: ConnectionsSummary | null;
  isLoading: boolean;
  error: string | null;
  source: "scan" | "cache" | "mock" | null;
  refresh: () => Promise<void>;
}

interface UseConnectionsOptions {
  demoMode?: boolean;
  autoFetch?: boolean;
  projectPath?: string;
}

export function useConnections(options: UseConnectionsOptions = {}): UseConnectionsResult {
  const { demoMode = false, autoFetch = true, projectPath: explicitPath } = options;
  const { activeProjectPath } = useActiveProject();
  const projectPath = explicitPath || activeProjectPath || undefined;

  const [connections, setConnections] = useState<Connection[]>([]);
  const [summary, setSummary] = useState<ConnectionsSummary | null>(null);
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

        const response = await fetch(`/api/connections?${params.toString()}`);
        const result: ConnectionsApiResponse = await response.json();

        if (result.success && result.data) {
          setConnections(result.data.connections);
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
    connections,
    summary,
    isLoading,
    error,
    source,
    refresh,
  };
}
