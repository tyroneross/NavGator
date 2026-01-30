/**
 * Hook for fetching and saving NavGator settings
 */

import { useState, useEffect, useCallback } from "react";

export interface ScanConfig {
  rootPath: string;
  excludePaths: string[];
  includePatterns: string[];
  scanDepth: number;
  watchMode: boolean;
  autoScanOnChange: boolean;
}

export interface DetectionConfig {
  npm: boolean;
  database: boolean;
  service: boolean;
  queue: boolean;
  cache: boolean;
  storage: boolean;
  auth: boolean;
  llm: boolean;
  staticAnalysis: boolean;
  environmentVariables: boolean;
  configFiles: boolean;
}

export interface NotificationConfig {
  enabled: boolean;
  onNewConnection: boolean;
  onBreakingChange: boolean;
  onSecurityIssue: boolean;
  slackWebhook: string;
}

export interface DisplayConfig {
  theme: "dark" | "light" | "system";
  compactMode: boolean;
  showLineNumbers: boolean;
  diagramDirection: "TB" | "LR";
  maxVisibleConnections: number;
}

export interface AllSettings {
  scan: ScanConfig;
  detection: DetectionConfig;
  notifications: NotificationConfig;
  display: DisplayConfig;
  lastSaved?: number;
}

interface UseSettingsResult {
  settings: AllSettings | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  source: "local" | "cache" | "default" | null;
  save: (data: Partial<AllSettings>) => Promise<boolean>;
  refresh: () => Promise<void>;
}

export function useSettings(options: { autoFetch?: boolean } = {}): UseSettingsResult {
  const { autoFetch = true } = options;

  const [settings, setSettings] = useState<AllSettings | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"local" | "cache" | "default" | null>(null);

  const fetchData = useCallback(async (forceRefresh = false) => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (forceRefresh) params.set("refresh", "true");

      const response = await fetch(`/api/settings?${params.toString()}`);
      const result = await response.json();

      if (result.success && result.data) {
        setSettings(result.data);
        setSource(result.source);
      } else {
        setError(result.error || "Failed to fetch settings");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const save = useCallback(async (data: Partial<AllSettings>): Promise<boolean> => {
    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = await response.json();

      if (result.success && result.data) {
        setSettings(result.data);
        return true;
      } else {
        setError(result.error || "Failed to save settings");
        return false;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      return false;
    } finally {
      setIsSaving(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    await fetchData(true);
  }, [fetchData]);

  useEffect(() => {
    if (autoFetch) {
      fetchData();
    }
  }, [autoFetch, fetchData]);

  return { settings, isLoading, isSaving, error, source, save, refresh };
}
