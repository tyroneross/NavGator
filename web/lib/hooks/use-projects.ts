/**
 * Hook for fetching and managing the project registry
 */

import { useState, useEffect, useCallback } from "react";

export interface RegisteredProject {
  path: string;
  name: string;
  addedAt: number;
  lastScan: number | null;
  hasArchitecture: boolean;
  componentCount: number;
  connectionCount: number;
  lastScanFormatted: string | null;
}

interface UseProjectsResult {
  projects: RegisteredProject[];
  activeProject: string | null;
  isLoading: boolean;
  error: string | null;
  setActiveProject: (path: string) => void;
  addProject: (path: string) => Promise<void>;
  removeProject: (path: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const ACTIVE_PROJECT_KEY = "navgator-active-project";

export function useProjects(): UseProjectsResult {
  const [projects, setProjects] = useState<RegisteredProject[]>([]);
  const [activeProject, setActiveProjectState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/projects");
      const result = await response.json();
      if (result.success) {
        setProjects(result.data.projects);
      } else {
        setError(result.error || "Failed to fetch projects");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const setActiveProject = useCallback((path: string) => {
    setActiveProjectState(path);
    localStorage.setItem(ACTIVE_PROJECT_KEY, path);
    // Dispatch custom event so other hooks/components react
    window.dispatchEvent(new CustomEvent("navgator-project-changed", { detail: { path } }));
  }, []);

  const addProject = useCallback(async (path: string) => {
    try {
      await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add", path }),
      });
      await fetchProjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add project");
    }
  }, [fetchProjects]);

  const removeProject = useCallback(async (path: string) => {
    try {
      await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove", path }),
      });
      // If we removed the active project, clear it
      if (path === activeProject) {
        setActiveProjectState(null);
        localStorage.removeItem(ACTIVE_PROJECT_KEY);
      }
      await fetchProjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove project");
    }
  }, [fetchProjects, activeProject]);

  // Load active project from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(ACTIVE_PROJECT_KEY);
    if (stored) {
      setActiveProjectState(stored);
    }
  }, []);

  // Fetch projects on mount
  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  return {
    projects,
    activeProject,
    isLoading,
    error,
    setActiveProject,
    addProject,
    removeProject,
    refresh: fetchProjects,
  };
}
