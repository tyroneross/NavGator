"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  FolderOpen,
  GitBranch,
  Bell,
  Shield,
  Palette,
  Terminal,
  Save,
  RotateCcw,
  Check,
  AlertCircle,
  Info,
} from "lucide-react"

interface ScanConfig {
  rootPath: string
  excludePaths: string[]
  includePatterns: string[]
  scanDepth: number
  watchMode: boolean
  autoScanOnChange: boolean
}

interface NotificationConfig {
  enabled: boolean
  onNewConnection: boolean
  onBreakingChange: boolean
  onSecurityIssue: boolean
  slackWebhook: string
}

interface DisplayConfig {
  theme: "dark" | "light" | "system"
  compactMode: boolean
  showLineNumbers: boolean
  diagramDirection: "TB" | "LR"
  maxVisibleConnections: number
}

export function SettingsPanel() {
  const [saved, setSaved] = useState(false)
  const [scanConfig, setScanConfig] = useState<ScanConfig>({
    rootPath: "./src",
    excludePaths: ["node_modules", ".git", "dist", "build", ".next"],
    includePatterns: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"],
    scanDepth: 10,
    watchMode: false,
    autoScanOnChange: true,
  })

  const [notificationConfig, setNotificationConfig] = useState<NotificationConfig>({
    enabled: true,
    onNewConnection: false,
    onBreakingChange: true,
    onSecurityIssue: true,
    slackWebhook: "",
  })

  const [displayConfig, setDisplayConfig] = useState<DisplayConfig>({
    theme: "dark",
    compactMode: false,
    showLineNumbers: true,
    diagramDirection: "TB",
    maxVisibleConnections: 50,
  })

  const handleSave = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleReset = () => {
    setScanConfig({
      rootPath: "./src",
      excludePaths: ["node_modules", ".git", "dist", "build", ".next"],
      includePatterns: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"],
      scanDepth: 10,
      watchMode: false,
      autoScanOnChange: true,
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Configure NavGator scanning behavior and display preferences
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-2 bg-transparent" onClick={handleReset}>
            <RotateCcw className="h-4 w-4" />
            Reset
          </Button>
          <Button size="sm" className="gap-2" onClick={handleSave}>
            {saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
            {saved ? "Saved" : "Save Changes"}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="scanning" className="w-full">
        <TabsList className="bg-secondary">
          <TabsTrigger value="scanning" className="gap-2">
            <FolderOpen className="h-4 w-4" />
            Scanning
          </TabsTrigger>
          <TabsTrigger value="detection" className="gap-2">
            <GitBranch className="h-4 w-4" />
            Detection
          </TabsTrigger>
          <TabsTrigger value="notifications" className="gap-2">
            <Bell className="h-4 w-4" />
            Notifications
          </TabsTrigger>
          <TabsTrigger value="display" className="gap-2">
            <Palette className="h-4 w-4" />
            Display
          </TabsTrigger>
        </TabsList>

        {/* Scanning Settings */}
        <TabsContent value="scanning" className="mt-4">
          <div className="grid gap-4">
            <Card className="border-border bg-card">
              <CardHeader>
                <CardTitle className="text-base">Scan Configuration</CardTitle>
                <CardDescription>
                  Configure which files and directories NavGator should analyze
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-6">
                <div className="grid gap-2">
                  <Label htmlFor="rootPath">Root Path</Label>
                  <Input
                    id="rootPath"
                    value={scanConfig.rootPath}
                    onChange={(e) =>
                      setScanConfig((c) => ({ ...c, rootPath: e.target.value }))
                    }
                    className="bg-secondary font-mono"
                    placeholder="./src"
                  />
                  <p className="text-xs text-muted-foreground">
                    Base directory for scanning (relative to project root)
                  </p>
                </div>

                <div className="grid gap-2">
                  <Label>Exclude Paths</Label>
                  <div className="flex flex-wrap gap-2">
                    {scanConfig.excludePaths.map((path, idx) => (
                      <Badge
                        key={idx}
                        variant="secondary"
                        className="gap-1 font-mono text-xs"
                      >
                        {path}
                        <button
                          type="button"
                          className="ml-1 hover:text-destructive"
                          onClick={() =>
                            setScanConfig((c) => ({
                              ...c,
                              excludePaths: c.excludePaths.filter((_, i) => i !== idx),
                            }))
                          }
                        >
                          x
                        </button>
                      </Badge>
                    ))}
                    <Input
                      placeholder="Add path..."
                      className="h-6 w-32 bg-secondary text-xs"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const value = e.currentTarget.value.trim()
                          if (value) {
                            setScanConfig((c) => ({
                              ...c,
                              excludePaths: [...c.excludePaths, value],
                            }))
                            e.currentTarget.value = ""
                          }
                        }
                      }}
                    />
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label>Include Patterns</Label>
                  <div className="flex flex-wrap gap-2">
                    {scanConfig.includePatterns.map((pattern, idx) => (
                      <Badge
                        key={idx}
                        variant="outline"
                        className="gap-1 font-mono text-xs"
                      >
                        {pattern}
                        <button
                          type="button"
                          className="ml-1 hover:text-destructive"
                          onClick={() =>
                            setScanConfig((c) => ({
                              ...c,
                              includePatterns: c.includePatterns.filter(
                                (_, i) => i !== idx
                              ),
                            }))
                          }
                        >
                          x
                        </button>
                      </Badge>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Glob patterns for files to include in analysis
                  </p>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="scanDepth">Scan Depth</Label>
                  <Select
                    value={scanConfig.scanDepth.toString()}
                    onValueChange={(v) =>
                      setScanConfig((c) => ({ ...c, scanDepth: Number.parseInt(v) }))
                    }
                  >
                    <SelectTrigger className="w-32 bg-secondary">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="5">5 levels</SelectItem>
                      <SelectItem value="10">10 levels</SelectItem>
                      <SelectItem value="15">15 levels</SelectItem>
                      <SelectItem value="20">20 levels</SelectItem>
                      <SelectItem value="-1">Unlimited</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Maximum directory depth to traverse
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border bg-card">
              <CardHeader>
                <CardTitle className="text-base">Watch Mode</CardTitle>
                <CardDescription>
                  Automatically detect changes in your codebase
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Enable Watch Mode</Label>
                    <p className="text-xs text-muted-foreground">
                      Monitor file changes in real-time
                    </p>
                  </div>
                  <Switch
                    checked={scanConfig.watchMode}
                    onCheckedChange={(v) =>
                      setScanConfig((c) => ({ ...c, watchMode: v }))
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label>Auto-scan on Change</Label>
                    <p className="text-xs text-muted-foreground">
                      Automatically re-analyze when files change
                    </p>
                  </div>
                  <Switch
                    checked={scanConfig.autoScanOnChange}
                    onCheckedChange={(v) =>
                      setScanConfig((c) => ({ ...c, autoScanOnChange: v }))
                    }
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Detection Settings */}
        <TabsContent value="detection" className="mt-4">
          <div className="grid gap-4">
            <Card className="border-border bg-card">
              <CardHeader>
                <CardTitle className="text-base">Component Detection</CardTitle>
                <CardDescription>
                  Configure what types of components NavGator should detect
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { id: "npm", label: "NPM Packages", desc: "Detect package.json dependencies" },
                    { id: "database", label: "Databases", desc: "PostgreSQL, MySQL, MongoDB, etc." },
                    { id: "service", label: "External Services", desc: "APIs, webhooks, third-party services" },
                    { id: "queue", label: "Message Queues", desc: "Redis, RabbitMQ, SQS, etc." },
                    { id: "cache", label: "Caching", desc: "Redis, Memcached, CDN caches" },
                    { id: "storage", label: "File Storage", desc: "S3, GCS, local filesystem" },
                    { id: "auth", label: "Authentication", desc: "OAuth, JWT, session providers" },
                    { id: "llm", label: "LLM Calls", desc: "AI/ML model invocations" },
                  ].map((item) => (
                    <div
                      key={item.id}
                      className="flex items-start justify-between rounded-lg border border-border bg-secondary/50 p-3"
                    >
                      <div>
                        <Label>{item.label}</Label>
                        <p className="text-xs text-muted-foreground">{item.desc}</p>
                      </div>
                      <Switch defaultChecked />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="border-border bg-card">
              <CardHeader>
                <CardTitle className="text-base">Connection Analysis</CardTitle>
                <CardDescription>
                  How NavGator identifies relationships between components
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Static Analysis</Label>
                    <p className="text-xs text-muted-foreground">
                      Analyze imports, function calls, and type references
                    </p>
                  </div>
                  <Switch defaultChecked />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Environment Variables</Label>
                    <p className="text-xs text-muted-foreground">
                      Detect service URLs from env vars
                    </p>
                  </div>
                  <Switch defaultChecked />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Config Files</Label>
                    <p className="text-xs text-muted-foreground">
                      Parse docker-compose, terraform, k8s manifests
                    </p>
                  </div>
                  <Switch defaultChecked />
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Notifications Settings */}
        <TabsContent value="notifications" className="mt-4">
          <div className="grid gap-4">
            <Card className="border-border bg-card">
              <CardHeader>
                <CardTitle className="text-base">Alert Preferences</CardTitle>
                <CardDescription>
                  Configure when and how you receive notifications
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Enable Notifications</Label>
                    <p className="text-xs text-muted-foreground">
                      Receive alerts for architecture changes
                    </p>
                  </div>
                  <Switch
                    checked={notificationConfig.enabled}
                    onCheckedChange={(v) =>
                      setNotificationConfig((c) => ({ ...c, enabled: v }))
                    }
                  />
                </div>

                <div className="border-t border-border pt-4">
                  <Label className="mb-3 block text-muted-foreground">Notify me when...</Label>
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Info className="h-4 w-4 text-info" />
                        <span className="text-sm">New connection detected</span>
                      </div>
                      <Switch
                        checked={notificationConfig.onNewConnection}
                        onCheckedChange={(v) =>
                          setNotificationConfig((c) => ({ ...c, onNewConnection: v }))
                        }
                        disabled={!notificationConfig.enabled}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 text-warning" />
                        <span className="text-sm">Breaking change detected</span>
                      </div>
                      <Switch
                        checked={notificationConfig.onBreakingChange}
                        onCheckedChange={(v) =>
                          setNotificationConfig((c) => ({ ...c, onBreakingChange: v }))
                        }
                        disabled={!notificationConfig.enabled}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Shield className="h-4 w-4 text-destructive" />
                        <span className="text-sm">Security issue found</span>
                      </div>
                      <Switch
                        checked={notificationConfig.onSecurityIssue}
                        onCheckedChange={(v) =>
                          setNotificationConfig((c) => ({ ...c, onSecurityIssue: v }))
                        }
                        disabled={!notificationConfig.enabled}
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border bg-card">
              <CardHeader>
                <CardTitle className="text-base">Integrations</CardTitle>
                <CardDescription>
                  Connect to external services for notifications
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="slack">Slack Webhook URL</Label>
                  <Input
                    id="slack"
                    type="url"
                    value={notificationConfig.slackWebhook}
                    onChange={(e) =>
                      setNotificationConfig((c) => ({ ...c, slackWebhook: e.target.value }))
                    }
                    className="bg-secondary font-mono"
                    placeholder="https://hooks.slack.com/services/..."
                  />
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary/50 p-3">
                  <Terminal className="h-4 w-4 text-muted-foreground" />
                  <code className="text-xs text-muted-foreground">
                    navgator config set slack-webhook &lt;url&gt;
                  </code>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Display Settings */}
        <TabsContent value="display" className="mt-4">
          <div className="grid gap-4">
            <Card className="border-border bg-card">
              <CardHeader>
                <CardTitle className="text-base">Appearance</CardTitle>
                <CardDescription>
                  Customize how NavGator looks and displays information
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="grid gap-2">
                  <Label>Theme</Label>
                  <Select
                    value={displayConfig.theme}
                    onValueChange={(v) =>
                      setDisplayConfig((c) => ({
                        ...c,
                        theme: v as DisplayConfig["theme"],
                      }))
                    }
                  >
                    <SelectTrigger className="w-40 bg-secondary">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dark">Dark</SelectItem>
                      <SelectItem value="light">Light</SelectItem>
                      <SelectItem value="system">System</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label>Compact Mode</Label>
                    <p className="text-xs text-muted-foreground">
                      Reduce padding and spacing for more content
                    </p>
                  </div>
                  <Switch
                    checked={displayConfig.compactMode}
                    onCheckedChange={(v) =>
                      setDisplayConfig((c) => ({ ...c, compactMode: v }))
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label>Show Line Numbers</Label>
                    <p className="text-xs text-muted-foreground">
                      Display line numbers in code snippets
                    </p>
                  </div>
                  <Switch
                    checked={displayConfig.showLineNumbers}
                    onCheckedChange={(v) =>
                      setDisplayConfig((c) => ({ ...c, showLineNumbers: v }))
                    }
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="border-border bg-card">
              <CardHeader>
                <CardTitle className="text-base">Diagram Preferences</CardTitle>
                <CardDescription>
                  Configure architecture diagram visualization
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="grid gap-2">
                  <Label>Default Direction</Label>
                  <Select
                    value={displayConfig.diagramDirection}
                    onValueChange={(v) =>
                      setDisplayConfig((c) => ({
                        ...c,
                        diagramDirection: v as DisplayConfig["diagramDirection"],
                      }))
                    }
                  >
                    <SelectTrigger className="w-40 bg-secondary">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="TB">Top to Bottom</SelectItem>
                      <SelectItem value="LR">Left to Right</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label>Max Visible Connections</Label>
                  <Select
                    value={displayConfig.maxVisibleConnections.toString()}
                    onValueChange={(v) =>
                      setDisplayConfig((c) => ({
                        ...c,
                        maxVisibleConnections: Number.parseInt(v),
                      }))
                    }
                  >
                    <SelectTrigger className="w-40 bg-secondary">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="25">25</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                      <SelectItem value="200">200</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Limit connections shown to improve performance
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
