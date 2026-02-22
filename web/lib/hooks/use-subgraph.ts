/**
 * Hook for extracting focused subgraphs from architecture
 */

import { useState, useEffect, useCallback } from "react";
import type { SubgraphResult, SubgraphApiResponse } from "../types";
import { useActiveProject } from "../project-context";

interface UseSubgraphResult {
  subgraph: SubgraphResult | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

interface UseSubgraphOptions {
  focus?: string[];
  depth?: number;
  layers?: string[];
  classification?: string;
  maxNodes?: number;
  autoFetch?: boolean;
  projectPath?: string;
}

export function useSubgraph(options: UseSubgraphOptions = {}): UseSubgraphResult {
  const {
    focus = [],
    depth = 2,
    layers = [],
    classification,
    maxNodes = 50,
    autoFetch = false,
    projectPath: explicitPath,
  } = options;
  const { activeProjectPath } = useActiveProject();
  const projectPath = explicitPath || activeProjectPath || undefined;

  const [subgraph, setSubgraph] = useState<SubgraphResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(
    async () => {
      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        if (focus.length > 0) params.set("focus", focus.join(","));
        params.set("depth", String(depth));
        if (layers.length > 0) params.set("layers", layers.join(","));
        if (classification) params.set("classification", classification);
        params.set("maxNodes", String(maxNodes));
        if (projectPath) params.set("path", projectPath);

        const response = await fetch(`/api/subgraph?${params.toString()}`);
        const result: SubgraphApiResponse = await response.json();

        if (result.success && result.data) {
          setSubgraph(result.data);
        } else {
          setError(result.error || "Failed to extract subgraph");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error");
      } finally {
        setIsLoading(false);
      }
    },
    [focus.join(","), depth, layers.join(","), classification, maxNodes, projectPath]
  );

  const refresh = useCallback(async () => {
    await fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (autoFetch) {
      fetchData();
    }
  }, [autoFetch, fetchData]);

  return { subgraph, isLoading, error, refresh };
}
