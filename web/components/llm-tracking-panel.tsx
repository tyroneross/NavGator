"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Search,
  Brain,
  MessageSquare,
  FileText,
  Clock,
  DollarSign,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Zap,
  AlertTriangle,
  Filter,
  RefreshCw,
  Loader2,
  Info,
  GitBranch,
  ArrowDown,
  Circle,
} from "lucide-react";
import { usePrompts } from "@/lib/hooks";
import type { LLMCall, Prompt } from "@/lib/types";

const categoryColors: Record<LLMCall["category"], string> = {
  chat: "bg-info/20 text-info border-info/30",
  completion: "bg-primary/20 text-primary border-primary/30",
  embedding: "bg-chart-3/20 text-chart-3 border-chart-3/30",
  function: "bg-chart-4/20 text-chart-4 border-chart-4/30",
  agent: "bg-warning/20 text-warning border-warning/30",
};

const typeColors: Record<Prompt["type"], string> = {
  system: "bg-info/20 text-info border-info/30",
  user: "bg-primary/20 text-primary border-primary/30",
  assistant: "bg-chart-3/20 text-chart-3 border-chart-3/30",
  function: "bg-chart-4/20 text-chart-4 border-chart-4/30",
};

export function LLMTrackingPanel() {
  // Fetch data from API (defaults to demo mode until real scan data exists)
  const { calls, prompts, summary, isLoading, error, source, refresh, scan } = usePrompts({
    autoFetch: true,
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCall, setSelectedCall] = useState<LLMCall | null>(null);
  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
  const [expandedCalls, setExpandedCalls] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [providerFilter, setProviderFilter] = useState<string>("all");

  const filteredCalls = calls.filter((call) => {
    const matchesSearch =
      call.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      call.model.toLowerCase().includes(searchQuery.toLowerCase()) ||
      call.file.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = categoryFilter === "all" || call.category === categoryFilter;
    const matchesProvider = providerFilter === "all" || call.provider === providerFilter;
    return matchesSearch && matchesCategory && matchesProvider;
  });

  const filteredPrompts = prompts.filter(
    (prompt) =>
      prompt.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      prompt.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
      prompt.file.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const toggleExpanded = (id: string) => {
    const next = new Set(expandedCalls);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setExpandedCalls(next);
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Calculate stats from real data
  const totalCalls = calls.reduce((sum, c) => sum + c.callCount, 0);
  const totalCost = calls.reduce((sum, c) => sum + (c.callCount / 1000) * c.estimatedCostPer1k, 0);
  const avgLatency = totalCalls > 0
    ? calls.reduce((sum, c) => sum + c.avgLatencyMs * c.callCount, 0) / totalCalls
    : 0;

  const providers = [...new Set(calls.map((c) => c.provider))];
  const categories = [...new Set(calls.map((c) => c.category))];

  return (
    <div className="flex flex-col gap-6">
      {/* Data Source Indicator */}
      {source === "mock" && (
        <div className="flex items-center gap-2 rounded-lg border border-info/30 bg-info/10 p-3">
          <Info className="h-4 w-4 text-info" />
          <p className="text-sm text-info">
            Showing demo data. Run <code className="rounded bg-info/20 px-1">navgator scan --prompts</code> to scan your project.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => scan()}
            disabled={isLoading}
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="ml-2">Scan Now</span>
          </Button>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Summary Stats */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="border-border bg-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                {isLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                ) : (
                  <Brain className="h-5 w-5 text-primary" />
                )}
              </div>
              <div>
                <p className="text-sm text-muted-foreground">LLM Calls</p>
                <p className="text-2xl font-semibold text-foreground">
                  {calls.length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-info/10">
                <FileText className="h-5 w-5 text-info" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Prompts</p>
                <p className="text-2xl font-semibold text-foreground">
                  {prompts.length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning/10">
                <Clock className="h-5 w-5 text-warning" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Avg Latency</p>
                <p className="text-2xl font-semibold text-foreground">
                  {avgLatency.toFixed(0)}ms
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-chart-4/10">
                <DollarSign className="h-5 w-5 text-chart-4" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Est. Cost (30d)</p>
                <p className="text-2xl font-semibold text-foreground">
                  ${totalCost.toFixed(2)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <Tabs defaultValue="calls" className="w-full">
        <div className="flex items-center justify-between gap-4">
          <TabsList className="bg-secondary">
            <TabsTrigger value="calls" className="gap-2">
              <Zap className="h-4 w-4" />
              LLM Calls
            </TabsTrigger>
            <TabsTrigger value="prompts" className="gap-2">
              <MessageSquare className="h-4 w-4" />
              Prompts
            </TabsTrigger>
            <TabsTrigger value="flow" className="gap-2">
              <GitBranch className="h-4 w-4" />
              AI Flow
            </TabsTrigger>
          </TabsList>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-64 bg-secondary pl-9"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refresh()}
              disabled={isLoading}
              title="Refresh data"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        <TabsContent value="calls" className="mt-4">
          {/* Filters */}
          <div className="mb-4 flex items-center gap-3">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <div className="flex gap-2">
              <Button
                variant={categoryFilter === "all" ? "default" : "outline"}
                size="sm"
                onClick={() => setCategoryFilter("all")}
              >
                All Types
              </Button>
              {categories.map((cat) => (
                <Button
                  key={cat}
                  variant={categoryFilter === cat ? "default" : "outline"}
                  size="sm"
                  onClick={() => setCategoryFilter(cat)}
                  className="capitalize"
                >
                  {cat}
                </Button>
              ))}
            </div>
            <div className="ml-4 flex gap-2">
              <Button
                variant={providerFilter === "all" ? "default" : "outline"}
                size="sm"
                onClick={() => setProviderFilter("all")}
              >
                All Providers
              </Button>
              {providers.map((prov) => (
                <Button
                  key={prov}
                  variant={providerFilter === prov ? "default" : "outline"}
                  size="sm"
                  onClick={() => setProviderFilter(prov)}
                  className="capitalize"
                >
                  {prov}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* LLM Calls List */}
            <Card className="border-border bg-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-medium">
                  Detected LLM Calls ({filteredCalls.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[500px]">
                  <div className="flex flex-col">
                    {filteredCalls.map((call) => (
                      <div key={call.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedCall(call);
                            toggleExpanded(call.id);
                          }}
                          className={`flex w-full items-start gap-3 border-b border-border p-4 text-left transition-colors hover:bg-secondary/50 ${
                            selectedCall?.id === call.id ? "bg-secondary" : ""
                          }`}
                        >
                          <div className="mt-0.5">
                            {expandedCalls.has(call.id) ? (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            )}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-sm text-foreground">
                                {call.name}
                              </span>
                              <Badge
                                variant="outline"
                                className={`text-xs ${categoryColors[call.category]}`}
                              >
                                {call.category}
                              </Badge>
                            </div>
                            <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                              <span>{call.model}</span>
                              <span>·</span>
                              <span>{call.provider}</span>
                              <span>·</span>
                              <span>{call.callCount.toLocaleString()} calls</span>
                            </div>
                            <p className="mt-1 font-mono text-xs text-muted-foreground">
                              {call.file}:{call.line}
                            </p>
                          </div>
                        </button>

                        {expandedCalls.has(call.id) && (
                          <div className="border-b border-border bg-secondary/30 p-4">
                            <div className="grid grid-cols-3 gap-4 text-sm">
                              <div>
                                <p className="text-muted-foreground">Avg Tokens In</p>
                                <p className="font-mono text-foreground">
                                  {call.avgTokensIn.toLocaleString()}
                                </p>
                              </div>
                              <div>
                                <p className="text-muted-foreground">Avg Tokens Out</p>
                                <p className="font-mono text-foreground">
                                  {call.avgTokensOut.toLocaleString()}
                                </p>
                              </div>
                              <div>
                                <p className="text-muted-foreground">Avg Latency</p>
                                <p className="font-mono text-foreground">
                                  {call.avgLatencyMs.toLocaleString()}ms
                                </p>
                              </div>
                            </div>
                            <div className="mt-3">
                              <p className="text-xs text-muted-foreground">
                                Variables:{" "}
                                {call.promptVariables.map((v) => (
                                  <code
                                    key={v}
                                    className="mx-1 rounded bg-secondary px-1 py-0.5"
                                  >
                                    {`{{${v}}}`}
                                  </code>
                                ))}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Call Details */}
            <Card className="border-border bg-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-medium">Call Details</CardTitle>
              </CardHeader>
              <CardContent>
                {selectedCall ? (
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-mono text-lg text-foreground">
                          {selectedCall.name}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {selectedCall.file}:{selectedCall.line}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={categoryColors[selectedCall.category]}
                      >
                        {selectedCall.category}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="rounded-lg bg-secondary p-3">
                        <p className="text-xs text-muted-foreground">Model</p>
                        <p className="font-mono text-sm text-foreground">
                          {selectedCall.model}
                        </p>
                      </div>
                      <div className="rounded-lg bg-secondary p-3">
                        <p className="text-xs text-muted-foreground">Provider</p>
                        <p className="font-mono text-sm capitalize text-foreground">
                          {selectedCall.provider}
                        </p>
                      </div>
                    </div>

                    {selectedCall.systemPrompt && (
                      <div>
                        <div className="mb-2 flex items-center justify-between">
                          <p className="text-sm font-medium text-foreground">
                            System Prompt
                          </p>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              copyToClipboard(
                                selectedCall.systemPrompt || "",
                                `sys-${selectedCall.id}`
                              )
                            }
                          >
                            {copiedId === `sys-${selectedCall.id}` ? (
                              <Check className="h-4 w-4 text-primary" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                        <pre className="rounded-lg bg-secondary p-3 font-mono text-xs text-muted-foreground">
                          {selectedCall.systemPrompt}
                        </pre>
                      </div>
                    )}

                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-sm font-medium text-foreground">
                          Prompt Template
                        </p>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            copyToClipboard(
                              selectedCall.promptTemplate,
                              `tpl-${selectedCall.id}`
                            )
                          }
                        >
                          {copiedId === `tpl-${selectedCall.id}` ? (
                            <Check className="h-4 w-4 text-primary" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                      <pre className="rounded-lg bg-secondary p-3 font-mono text-xs text-muted-foreground">
                        {selectedCall.promptTemplate}
                      </pre>
                    </div>

                    <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3">
                      <AlertTriangle className="h-4 w-4 text-warning" />
                      <p className="text-sm text-warning">
                        Est. cost: $
                        {(
                          (selectedCall.callCount / 1000) *
                          selectedCall.estimatedCostPer1k
                        ).toFixed(2)}{" "}
                        (30d)
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex h-[400px] items-center justify-center text-muted-foreground">
                    <p>Select an LLM call to view details</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="prompts" className="mt-4">
          <div className="grid grid-cols-2 gap-4">
            {/* Prompts List */}
            <Card className="border-border bg-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-medium">
                  Prompt Library ({filteredPrompts.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[500px]">
                  <div className="flex flex-col">
                    {filteredPrompts.map((prompt) => (
                      <button
                        key={prompt.id}
                        type="button"
                        onClick={() => setSelectedPrompt(prompt)}
                        className={`flex w-full items-start gap-3 border-b border-border p-4 text-left transition-colors hover:bg-secondary/50 ${
                          selectedPrompt?.id === prompt.id ? "bg-secondary" : ""
                        }`}
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm text-foreground">
                              {prompt.name}
                            </span>
                            <Badge
                              variant="outline"
                              className={`text-xs ${typeColors[prompt.type]}`}
                            >
                              {prompt.type}
                            </Badge>
                          </div>
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                            {prompt.content}
                          </p>
                          <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                            <span>{prompt.tokenCount} tokens</span>
                            <span>·</span>
                            <span>v{prompt.version}</span>
                            <span>·</span>
                            <span>{prompt.lastModified}</span>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Prompt Details */}
            <Card className="border-border bg-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-medium">Prompt Details</CardTitle>
              </CardHeader>
              <CardContent>
                {selectedPrompt ? (
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-mono text-lg text-foreground">
                          {selectedPrompt.name}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {selectedPrompt.file}:{selectedPrompt.line}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          v{selectedPrompt.version}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={typeColors[selectedPrompt.type]}
                        >
                          {selectedPrompt.type}
                        </Badge>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="rounded-lg bg-secondary p-3">
                        <p className="text-xs text-muted-foreground">Token Count</p>
                        <p className="font-mono text-sm text-foreground">
                          {selectedPrompt.tokenCount}
                        </p>
                      </div>
                      <div className="rounded-lg bg-secondary p-3">
                        <p className="text-xs text-muted-foreground">Last Modified</p>
                        <p className="font-mono text-sm text-foreground">
                          {selectedPrompt.lastModified}
                        </p>
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-sm font-medium text-foreground">Content</p>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            copyToClipboard(
                              selectedPrompt.content,
                              `content-${selectedPrompt.id}`
                            )
                          }
                        >
                          {copiedId === `content-${selectedPrompt.id}` ? (
                            <Check className="h-4 w-4 text-primary" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                      <pre className="max-h-[200px] overflow-auto rounded-lg bg-secondary p-3 font-mono text-xs text-muted-foreground">
                        {selectedPrompt.content}
                      </pre>
                    </div>

                    {selectedPrompt.variables.length > 0 && (
                      <div>
                        <p className="mb-2 text-sm font-medium text-foreground">
                          Variables
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {selectedPrompt.variables.map((v) => (
                            <code
                              key={v}
                              className="rounded bg-secondary px-2 py-1 font-mono text-xs text-muted-foreground"
                            >
                              {`{{${v}}}`}
                            </code>
                          ))}
                        </div>
                      </div>
                    )}

                    <div>
                      <p className="mb-2 text-sm font-medium text-foreground">Used By</p>
                      <div className="flex flex-wrap gap-2">
                        {selectedPrompt.usedBy.map((fn) => (
                          <Badge key={fn} variant="outline" className="font-mono">
                            {fn}()
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex h-[400px] items-center justify-center text-muted-foreground">
                    <p>Select a prompt to view details</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="flow" className="mt-4">
          <AIFlowDiagram prompts={prompts} calls={calls} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// =============================================================================
// AI FLOW DIAGRAM COMPONENT
// =============================================================================

interface AIFlowDiagramProps {
  prompts: Prompt[];
  calls: LLMCall[];
}

interface FlowNode {
  id: string;
  name: string;
  file: string;
  type: "input" | "process" | "output";
  category?: string;
  purpose?: string;
  prompts: Prompt[];
}

function AIFlowDiagram({ prompts, calls }: AIFlowDiagramProps) {
  // Group prompts by file and categorize them
  const groupedByFile = prompts.reduce((acc, prompt) => {
    const file = prompt.file;
    if (!acc[file]) {
      acc[file] = [];
    }
    acc[file].push(prompt);
    return acc;
  }, {} as Record<string, Prompt[]>);

  // Categorize files into flow stages based on naming patterns and prompt types
  const categorizeFile = (file: string, filePrompts: Prompt[]): "input" | "process" | "output" => {
    const lowerFile = file.toLowerCase();

    // Input/routing patterns
    if (
      lowerFile.includes("router") ||
      lowerFile.includes("query") ||
      lowerFile.includes("classify") ||
      lowerFile.includes("input") ||
      lowerFile.includes("parse")
    ) {
      return "input";
    }

    // Output patterns
    if (
      lowerFile.includes("summar") ||
      lowerFile.includes("output") ||
      lowerFile.includes("response") ||
      lowerFile.includes("format") ||
      lowerFile.includes("render")
    ) {
      return "output";
    }

    // Check prompt purposes/categories
    const hasInput = filePrompts.some(p =>
      p.purpose?.toLowerCase().includes("classif") ||
      p.purpose?.toLowerCase().includes("rout") ||
      p.category?.toLowerCase().includes("input")
    );
    if (hasInput) return "input";

    const hasOutput = filePrompts.some(p =>
      p.purpose?.toLowerCase().includes("summar") ||
      p.purpose?.toLowerCase().includes("format") ||
      p.category?.toLowerCase().includes("output")
    );
    if (hasOutput) return "output";

    return "process";
  };

  // Build flow nodes
  const flowNodes: FlowNode[] = Object.entries(groupedByFile).map(([file, filePrompts]) => {
    const type = categorizeFile(file, filePrompts);
    const fileName = file.split("/").pop() || file;

    return {
      id: file,
      name: fileName.replace(/\.(ts|js|tsx|jsx|py)$/, ""),
      file,
      type,
      category: filePrompts[0]?.category,
      purpose: filePrompts[0]?.purpose,
      prompts: filePrompts,
    };
  });

  // Sort by type order: input -> process -> output
  const typeOrder = { input: 0, process: 1, output: 2 };
  flowNodes.sort((a, b) => typeOrder[a.type] - typeOrder[b.type]);

  // Group by type for display
  const inputNodes = flowNodes.filter(n => n.type === "input");
  const processNodes = flowNodes.filter(n => n.type === "process");
  const outputNodes = flowNodes.filter(n => n.type === "output");

  const typeColors = {
    input: "border-info bg-info/10 text-info",
    process: "border-primary bg-primary/10 text-primary",
    output: "border-chart-3 bg-chart-3/10 text-chart-3",
  };

  const typeLabels = {
    input: "Input / Routing",
    process: "Processing / Analysis",
    output: "Output / Summary",
  };

  if (prompts.length === 0) {
    return (
      <Card className="border-border bg-card">
        <CardContent className="flex flex-col items-center justify-center py-16">
          <GitBranch className="h-12 w-12 text-muted-foreground/50" />
          <p className="mt-4 text-muted-foreground">No AI prompts detected</p>
          <p className="mt-1 text-xs text-muted-foreground/80">
            Run <code className="rounded bg-secondary px-1.5">navgator scan --prompts</code> to detect AI flows
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Flow Legend */}
      <div className="flex items-center gap-6 text-xs">
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full border-2 border-info bg-info/30" />
          <span className="text-muted-foreground">Input/Routing</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full border-2 border-primary bg-primary/30" />
          <span className="text-muted-foreground">Processing</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full border-2 border-chart-3 bg-chart-3/30" />
          <span className="text-muted-foreground">Output/Summary</span>
        </div>
      </div>

      {/* Flow Diagram */}
      <Card className="border-border bg-card">
        <CardContent className="p-6">
          <div className="relative flex flex-col items-center gap-2">
            {/* User Input */}
            <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary px-4 py-2">
              <Circle className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">User Input</span>
            </div>

            {inputNodes.length > 0 && (
              <>
                <ArrowDown className="h-5 w-5 text-muted-foreground" />
                <FlowStage
                  label={typeLabels.input}
                  nodes={inputNodes}
                  colorClass={typeColors.input}
                />
              </>
            )}

            {processNodes.length > 0 && (
              <>
                <ArrowDown className="h-5 w-5 text-muted-foreground" />
                <FlowStage
                  label={typeLabels.process}
                  nodes={processNodes}
                  colorClass={typeColors.process}
                />
              </>
            )}

            {outputNodes.length > 0 && (
              <>
                <ArrowDown className="h-5 w-5 text-muted-foreground" />
                <FlowStage
                  label={typeLabels.output}
                  nodes={outputNodes}
                  colorClass={typeColors.output}
                />
              </>
            )}

            <ArrowDown className="h-5 w-5 text-muted-foreground" />

            {/* Response */}
            <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary px-4 py-2">
              <Circle className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">Response</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Detailed File List */}
      <Card className="border-border bg-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">
            Files with AI Prompts ({Object.keys(groupedByFile).length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[300px]">
            <div className="space-y-2">
              {flowNodes.map((node) => (
                <div
                  key={node.id}
                  className={`rounded-lg border p-3 ${typeColors[node.type]}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-medium">{node.name}</span>
                      <Badge variant="outline" className="text-xs">
                        {node.prompts.length} prompt{node.prompts.length !== 1 ? "s" : ""}
                      </Badge>
                    </div>
                    <Badge variant="outline" className="text-xs capitalize">
                      {node.type}
                    </Badge>
                  </div>
                  <p className="mt-1 font-mono text-xs opacity-70">{node.file}</p>
                  {node.purpose && (
                    <p className="mt-2 text-xs">{node.purpose}</p>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

interface FlowStageProps {
  label: string;
  nodes: FlowNode[];
  colorClass: string;
}

function FlowStage({ label, nodes, colorClass }: FlowStageProps) {
  return (
    <div className="w-full max-w-2xl">
      <div className="mb-2 text-center text-xs font-medium text-muted-foreground">
        {label}
      </div>
      <div className={`rounded-lg border-2 p-4 ${colorClass}`}>
        <div className="flex flex-wrap justify-center gap-3">
          {nodes.map((node) => (
            <div
              key={node.id}
              className="flex items-center gap-2 rounded-md bg-background/50 px-3 py-1.5"
            >
              <FileText className="h-3.5 w-3.5" />
              <span className="font-mono text-xs">{node.name}</span>
              <span className="text-xs opacity-60">({node.prompts.length})</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
