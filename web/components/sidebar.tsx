"use client"

import {
  LayoutDashboard,
  Boxes,
  GitBranch,
  Target,
  Share2,
  Settings,
  Brain,
  Shield,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { View } from "@/app/page"

interface SidebarProps {
  activeView: View
  setActiveView: (view: View) => void
}

const navItems = [
  { id: "overview" as const, label: "Overview", icon: LayoutDashboard },
  { id: "components" as const, label: "Components", icon: Boxes },
  { id: "connections" as const, label: "Connections", icon: GitBranch },
  { id: "impact" as const, label: "Impact", icon: Target },
  { id: "diagram" as const, label: "Diagram", icon: Share2 },
  { id: "llm" as const, label: "LLM Tracking", icon: Brain },
  { id: "rules" as const, label: "Rules", icon: Shield },
]

export function Sidebar({ activeView, setActiveView }: SidebarProps) {
  return (
    <aside className="hidden w-56 shrink-0 border-r border-border bg-sidebar md:block">
      <nav className="flex h-full flex-col p-3">
        <div className="space-y-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveView(item.id)}
              className={cn(
                "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                activeView === item.id
                  ? "bg-sidebar-accent text-sidebar-primary"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
              {activeView === item.id && (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-sidebar-primary" />
              )}
            </button>
          ))}
        </div>

        <div className="mt-auto space-y-1 border-t border-sidebar-border pt-3">
          <button
            onClick={() => setActiveView("settings")}
            className={cn(
              "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              activeView === "settings"
                ? "bg-sidebar-accent text-sidebar-primary"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
            )}
          >
            <Settings className="h-4 w-4" />
            Settings
            {activeView === "settings" && (
              <span className="ml-auto h-1.5 w-1.5 rounded-full bg-sidebar-primary" />
            )}
          </button>
        </div>
      </nav>
    </aside>
  )
}
