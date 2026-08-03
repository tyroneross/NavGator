/**
 * Hook for fetching registry health (`navgator doctor`) and running the
 * tmp-rooted/missing-entry cleanup (`navgator doctor --fix --yes`).
 */

import { useState, useEffect, useCallback } from "react";
import type {
  RegistryHealthApiResponse,
  RegistryHealthCleanupResult,
  RegistryHealthFixApiResponse,
  RegistryHealthReport,
} from "../types";

interface UseRegistryHealthResult {
  data: RegistryHealthReport | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  cleanup: () => Promise<RegistryHealthCleanupResult | null>;
  isCleaning: boolean;
  cleanupError: string | null;
}

export function useRegistryHealth(): UseRegistryHealthResult {
  const [data, setData] = useState<RegistryHealthReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCleaning, setIsCleaning] = useState(false);
  const [cleanupError, setCleanupError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/registry-health");
      const result: RegistryHealthApiResponse = await response.json();
      if (result.success && result.data) {
        setData(result.data);
      } else {
        setData(null);
        setError(result.error || "Failed to fetch registry health");
      }
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    await fetchData();
  }, [fetchData]);

  const cleanup = useCallback(async (): Promise<RegistryHealthCleanupResult | null> => {
    setIsCleaning(true);
    setCleanupError(null);
    try {
      const response = await fetch("/api/registry-health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "prune-tmp", confirm: true }),
      });
      const result: RegistryHealthFixApiResponse = await response.json();
      if (result.success && result.data) {
        const { cleanup: cleanupResult } = result.data;
        return cleanupResult;
      }
      setCleanupError(result.error || "Failed to clean up registry");
      return null;
    } catch (err) {
      setCleanupError(err instanceof Error ? err.message : "Network error");
      return null;
    } finally {
      setIsCleaning(false);
      await fetchData();
    }
  }, [fetchData]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    data,
    isLoading,
    error,
    refresh,
    cleanup,
    isCleaning,
    cleanupError,
  };
}
