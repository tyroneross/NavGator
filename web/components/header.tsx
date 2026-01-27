"use client"

import Image from "next/image"
import { Search, RefreshCw, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useState } from "react"

export function Header() {
  const [isScanning, setIsScanning] = useState(false)

  const handleScan = async () => {
    setIsScanning(true)
    try {
      // Trigger actual scan via API
      await fetch("/api/scan", { method: "POST" })
      // Refresh data after scan
      window.location.reload()
    } catch (error) {
      console.error("Scan failed:", error)
    } finally {
      setIsScanning(false)
    }
  }

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
                my-project
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem>my-project</DropdownMenuItem>
              <DropdownMenuItem>another-project</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
