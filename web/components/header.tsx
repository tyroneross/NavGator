"use client"

import Image from "next/image"
import { Search, RefreshCw, ChevronDown, FolderOpen, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useState, useEffect, useRef } from "react"

interface RegisteredProject {
  path: string
  name: string
  hasArchitecture: boolean
  componentCount: number
  connectionCount: number
  lastScanFormatted: string | null
}

interface HeaderProps {
  activeProject: string | null
  projectName: string | null
  projectPath: string | null
  projects: RegisteredProject[]
  onSelectProject: (path: string) => void
  onAddProject: (path: string) => Promise<void>
  onRemoveProject: (path: string) => Promise<void>
  isLoadingProjects: boolean
}

export function Header({
  activeProject,
  projectName,
  projectPath,
  projects,
  onSelectProject,
  onAddProject,
  onRemoveProject,
  isLoadingProjects,
}: HeaderProps) {
  const [isScanning, setIsScanning] = useState(false)
  const [showAddInput, setShowAddInput] = useState(false)
  const [addPath, setAddPath] = useState("")
  const addInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (showAddInput && addInputRef.current) {
      addInputRef.current.focus()
    }
  }, [showAddInput])

  const handleScan = async () => {
    setIsScanning(true)
    try {
      await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: activeProject }),
      })
      window.location.reload()
    } catch (error) {
      console.error("Scan failed:", error)
    } finally {
      setIsScanning(false)
    }
  }

  const handleAddProject = async () => {
    if (!addPath.trim()) return
    await onAddProject(addPath.trim())
    onSelectProject(addPath.trim())
    setAddPath("")
    setShowAddInput(false)
  }

  const displayName = projectName || "No Project"

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-card px-4">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Image
            src="/navgator-logo.png"
            alt="NavGator"
            width={36}
            height={36}
            className="rounded-lg"
          />
          <span className="font-semibold text-foreground">NavGator</span>
        </div>

        <div className="hidden items-center gap-1 text-sm text-muted-foreground md:flex">
          <span>/</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-auto gap-1 px-2 py-1 text-foreground">
                {isLoadingProjects ? (
                  <span className="animate-pulse">Loading...</span>
                ) : (
                  displayName
                )}
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              {projects.length === 0 && !showAddInput && (
                <div className="px-3 py-2 text-sm text-muted-foreground">
                  No projects registered
                </div>
              )}

              {projects.map((project) => (
                <DropdownMenuItem
                  key={project.path}
                  className="flex items-center justify-between gap-2 py-2"
                  onSelect={() => onSelectProject(project.path)}
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className={`text-sm font-medium truncate ${
                      project.path === activeProject ? "text-blue-700 dark:text-blue-400" : ""
                    }`}>
                      {project.name}
                    </span>
                    <span className="text-xs text-muted-foreground truncate">
                      {project.hasArchitecture
                        ? `${project.componentCount} components · ${project.lastScanFormatted || "never scanned"}`
                        : "Not scanned yet"}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 w-5 shrink-0 p-0 text-muted-foreground hover:text-red-600"
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemoveProject(project.path)
                    }}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </DropdownMenuItem>
              ))}

              {projects.length > 0 && <DropdownMenuSeparator />}

              {showAddInput ? (
                <div className="flex items-center gap-1 px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                  <Input
                    ref={addInputRef}
                    value={addPath}
                    onChange={(e) => setAddPath(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddProject()
                      if (e.key === "Escape") { setShowAddInput(false); setAddPath("") }
                    }}
                    placeholder="/path/to/project"
                    className="h-7 text-xs"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 shrink-0 px-2 text-xs"
                    onClick={handleAddProject}
                  >
                    Add
                  </Button>
                </div>
              ) : (
                <DropdownMenuItem onSelect={() => setShowAddInput(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add project
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {projectPath && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-md">
                  <p className="font-mono text-xs">{projectPath}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative hidden w-64 md:block">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search components..."
            className="h-8 bg-secondary pl-9 text-sm"
          />
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={handleScan}
          disabled={isScanning}
          className="gap-2 bg-transparent"
        >
          <RefreshCw className={`h-4 w-4 ${isScanning ? "animate-spin" : ""}`} />
          <span className="hidden sm:inline">{isScanning ? "Scanning..." : "Scan"}</span>
        </Button>
      </div>
    </header>
  )
}
