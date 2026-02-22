/**
 * Hook for fetching architecture coverage data
 */

import { useState, useEffect, useCallback } from "react";
import type { CoverageReport, CoverageApiResponse } from "../types";
import { useActiveProject } from "../project-context";

interface UseCoverageResult {
  coverage: CoverageReport | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

interface UseCoverageOptions {
  autoFetch?: boolean;
  projectPath?: string;
}

export function useCoverage(options: UseCoverageOptions = {}): UseCoverageResult {
  const { autoFetch = true, projectPath: explicitPath } = options;
  const { activeProjectPath } = useActiveProject();
  const projectPath = explicitPath || activeProjectPath || undefined;

  const [coverage, setCoverage] = useState<CoverageReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(
    async (forceRefresh = false) => {
      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        if (forceRefresh) params.set("refresh", "true");
        if (projectPath) params.set("path", projectPath);

        const response = await fetch(`/api/coverage?${params.toString()}`);
        const result: CoverageApiResponse = await response.json();

        if (result.success && result.data) {
          setCoverage(result.data);
        } else {
          setError(result.error || "Failed to fetch coverage data");
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

  return { coverage, isLoading, error, refresh };
}
