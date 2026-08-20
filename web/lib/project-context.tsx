"use client"

import { createContext, useContext, useState, useEffect, type ReactNode } from "react"

interface ProjectContextValue {
  activeProjectPath: string | null
  isHydrated: boolean
  setActiveProjectPath: (path: string | null) => void
}

const ProjectContext = createContext<ProjectContextValue>({
  activeProjectPath: null,
  isHydrated: false,
  setActiveProjectPath: () => {},
})

const ACTIVE_PROJECT_KEY = "navgator-active-project"

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [activeProjectPath, setActiveProjectPathState] = useState<string | null>(null)
  const [isHydrated, setIsHydrated] = useState(false)

  // Load from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(ACTIVE_PROJECT_KEY)
    if (stored) {
      setActiveProjectPathState(stored)
    }
    setIsHydrated(true)
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
    <ProjectContext.Provider value={{ activeProjectPath, isHydrated, setActiveProjectPath }}>
      {children}
    </ProjectContext.Provider>
  )
}

export function useActiveProject() {
  return useContext(ProjectContext)
}
