"use client"

import { createContext, useContext, useState, useEffect, type ReactNode } from "react"

interface ProjectContextValue {
  activeProjectPath: string | null
  setActiveProjectPath: (path: string | null) => void
}

const ProjectContext = createContext<ProjectContextValue>({
  activeProjectPath: null,
  setActiveProjectPath: () => {},
})

const ACTIVE_PROJECT_KEY = "navgator-active-project"

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [activeProjectPath, setActiveProjectPathState] = useState<string | null>(null)

  // Load from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(ACTIVE_PROJECT_KEY)
    if (stored) {
      setActiveProjectPathState(stored)
    }
  }, [])

  const setActiveProjectPath = (path: string | null) => {
    setActiveProjectPathState(path)
    if (path) {
      localStorage.setItem(ACTIVE_PROJECT_KEY, path)
    } else {
      localStorage.removeItem(ACTIVE_PROJECT_KEY)
    }
  }

  return (
    <ProjectContext.Provider value={{ activeProjectPath, setActiveProjectPath }}>
      {children}
    </ProjectContext.Provider>
  )
}

export function useActiveProject() {
  return useContext(ProjectContext)
}
