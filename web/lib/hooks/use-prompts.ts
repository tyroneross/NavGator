/**
 * Hook for fetching and managing prompt/LLM call data
 */

import { useState, useEffect, useCallback } from "react";
import type { LLMCall, Prompt, LLMTrackingSummary, PromptsApiResponse } from "../types";

interface UsePromptsResult {
  calls: LLMCall[];
  prompts: Prompt[];
  summary: LLMTrackingSummary | null;
  isLoading: boolean;
  error: string | null;
  source: "scan" | "cache" | "mock" | null;
  refresh: () => Promise<void>;
  scan: (projectPath?: string) => Promise<void>;
}

interface UsePromptsOptions {
  /** Start in demo mode (use mock data) */
  demoMode?: boolean;
  /** Auto-fetch on mount */
  autoFetch?: boolean;
  /** Project path for scans */
  projectPath?: string;
}

export function usePrompts(options: UsePromptsOptions = {}): UsePromptsResult {
  const { demoMode = false, autoFetch = true, projectPath } = options;

  const [calls, setCalls] = useState<LLMCall[]>([]);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [summary, setSummary] = useState<LLMTrackingSummary | null>(null);
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

        const response = await fetch(`/api/prompts?${params.toString()}`);
        const result: PromptsApiResponse = await response.json();

        if (result.success && result.data) {
          setCalls(result.data.calls);
          setPrompts(result.data.prompts);
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

  const scan = useCallback(
    async (path?: string) => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/prompts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: path || projectPath }),
        });
        const result: PromptsApiResponse = await response.json();

        if (result.success && result.data) {
          setCalls(result.data.calls);
          setPrompts(result.data.prompts);
          setSummary(result.data.summary);
          setSource(result.source);
        } else {
          setError(result.error || "Scan failed");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error");
      } finally {
        setIsLoading(false);
      }
    },
    [projectPath]
  );

  useEffect(() => {
    if (autoFetch) {
      fetchData();
    }
  }, [autoFetch, fetchData]);

  return {
    calls,
    prompts,
    summary,
    isLoading,
    error,
    source,
    refresh,
    scan,
  };
}
