/**
 * API Route: /api/connections
 *
 * Returns architecture connection data from NavGator scans.
 */

import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs/promises";
import * as path from "path";
import type { Connection, ConnectionsApiResponse, ConnectionsSummary } from "@/lib/types";

// Cache for connection data
let cachedData: ConnectionsApiResponse["data"] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60000; // 1 minute cache

/**
 * GET /api/connections
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const demoMode = searchParams.get("demo") === "true";
  const refresh = searchParams.get("refresh") === "true";
  const projectPath = searchParams.get("path");

  // Demo mode
  if (demoMode) {
    return NextResponse.json<ConnectionsApiResponse>({
      success: true,
      data: generateDemoConnections(),
      source: "mock",
    });
  }

  // Check cache
  if (!refresh && cachedData && Date.now() - cacheTimestamp < CACHE_TTL) {
    return NextResponse.json<ConnectionsApiResponse>({
      success: true,
      data: cachedData,
      source: "cache",
    });
  }

  try {
    const data = await loadConnectionData(projectPath);

    if (data) {
      cachedData = data;
      cacheTimestamp = Date.now();

      return NextResponse.json<ConnectionsApiResponse>({
        success: true,
        data,
        source: "scan",
      });
    }

    // No scan data - check if user explicitly wants demo
    if (demoMode) {
      return NextResponse.json<ConnectionsApiResponse>({
        success: true,
        data: generateDemoConnections(),
        source: "mock",
      });
    }

    // Return empty state - prompt user to run setup
    return NextResponse.json<ConnectionsApiResponse>({
      success: true,
      data: {
        connections: [],
        summary: {
          totalConnections: 0,
          byType: {},
        },
      },
      source: "scan",
      error: "No scan data found. Run `navgator setup` to scan your project.",
    });
  } catch (error) {
    console.error("Error loading connection data:", error);
    return NextResponse.json<ConnectionsApiResponse>({
      success: false,
      data: {
        connections: [],
        summary: {
          totalConnections: 0,
          byType: {},
        },
      },
      source: "scan",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

// =============================================================================
// DATA LOADING
// =============================================================================

async function loadConnectionData(
  projectPath?: string | null
): Promise<ConnectionsApiResponse["data"] | null> {
  // Priority: query param > env var > NavGator directory
  const root = projectPath ||
    process.env.NAVGATOR_PROJECT_PATH ||
    process.cwd().replace(/\/web$/, "");

  // Try to load from NavGator storage
  const connectionsDir = path.join(root, ".claude", "architecture", "connections");

  try {
    const files = await fs.readdir(connectionsDir);
    const connectionFiles = files.filter((f) => f.endsWith(".json"));

    if (connectionFiles.length === 0) return null;

    const connections: Connection[] = [];

    for (const file of connectionFiles) {
      try {
        const content = await fs.readFile(path.join(connectionsDir, file), "utf-8");
        const raw = JSON.parse(content);
        connections.push(transformConnection(raw));
      } catch {
        // Skip invalid files
      }
    }

    if (connections.length === 0) return null;

    return {
      connections,
      summary: buildSummary(connections),
    };
  } catch {
    return null;
  }
}

function transformConnection(raw: Record<string, unknown>): Connection {
  const from = raw.from as Record<string, unknown> | undefined;
  const to = raw.to as Record<string, unknown> | undefined;
  const codeRef = raw.code_reference as Record<string, unknown> | undefined;

  return {
    id: String(raw.connection_id || raw.id || ""),
    from: codeRef?.file ? String(codeRef.file) : String(from?.component_id || ""),
    fromComponent: String(from?.component_id || ""),
    to: String(to?.component_id || ""),
    toComponent: String(to?.component_id || ""),
    type: mapConnectionType(String(raw.connection_type || "")),
    symbol: String(codeRef?.symbol || codeRef?.function_name || ""),
    line: Number(codeRef?.line_start || 0),
    code: String(codeRef?.code_snippet || ""),
    confidence: Number(raw.confidence || 0.8),
  };
}

function mapConnectionType(type: string): Connection["type"] {
  const typeMap: Record<string, Connection["type"]> = {
    "service-call": "service-call",
    "api-calls-db": "api-calls-db",
    "frontend-calls-api": "frontend-calls-api",
    "queue-triggers": "queue-triggers",
    "imports": "imports",
    "prompt-usage": "prompt-usage",
    "prompt-location": "prompt-usage",
    "deploys-to": "deploys-to",
  };
  return typeMap[type] || "service-call";
}

function buildSummary(connections: Connection[]): ConnectionsSummary {
  const byType: Record<string, number> = {};

  for (const c of connections) {
    byType[c.type] = (byType[c.type] || 0) + 1;
  }

  return {
    totalConnections: connections.length,
    byType,
    lastScanned: new Date().toISOString(),
  };
}

// =============================================================================
// DEMO DATA
// =============================================================================

function generateDemoConnections(): ConnectionsApiResponse["data"] {
  const connections: Connection[] = [
    {
      id: "conn-1",
      from: "src/api/payments.ts",
      to: "Stripe",
      type: "service-call",
      symbol: "createPaymentIntent",
      line: 45,
      code: "await stripe.paymentIntents.create({...})",
    },
    {
      id: "conn-2",
      from: "src/api/subscriptions.ts",
      to: "Stripe",
      type: "service-call",
      symbol: "createSubscription",
      line: 23,
      code: "await stripe.subscriptions.create({...})",
    },
    {
      id: "conn-3",
      from: "src/webhooks/stripe.ts",
      to: "Stripe",
      type: "service-call",
      symbol: "handleWebhook",
      line: 12,
      code: "stripe.webhooks.constructEvent(...)",
    },
    {
      id: "conn-4",
      from: "src/api/users.ts",
      to: "PostgreSQL",
      type: "api-calls-db",
      symbol: "getUser",
      line: 15,
      code: "prisma.user.findUnique({...})",
    },
    {
      id: "conn-5",
      from: "src/api/users.ts",
      to: "PostgreSQL",
      type: "api-calls-db",
      symbol: "createUser",
      line: 32,
      code: "prisma.user.create({...})",
    },
    {
      id: "conn-6",
      from: "src/api/posts.ts",
      to: "PostgreSQL",
      type: "api-calls-db",
      symbol: "getPosts",
      line: 8,
      code: "prisma.post.findMany({...})",
    },
    {
      id: "conn-7",
      from: "src/components/PaymentForm.tsx",
      to: "src/api/payments.ts",
      type: "frontend-calls-api",
      symbol: "submitPayment",
      line: 28,
      code: "fetch('/api/payments', {...})",
    },
    {
      id: "conn-8",
      from: "src/components/Dashboard.tsx",
      to: "src/api/users.ts",
      type: "frontend-calls-api",
      symbol: "loadUserData",
      line: 15,
      code: "useSWR('/api/users/me')",
    },
    {
      id: "conn-9",
      from: "src/jobs/emailJob.ts",
      to: "SendGrid",
      type: "service-call",
      symbol: "sendEmail",
      line: 22,
      code: "sgMail.send({...})",
    },
    {
      id: "conn-10",
      from: "src/api/ai.ts",
      to: "OpenAI",
      type: "service-call",
      symbol: "generateCompletion",
      line: 18,
      code: "openai.chat.completions.create({...})",
    },
    {
      id: "conn-11",
      from: "src/api/chat.ts",
      to: "Anthropic",
      type: "service-call",
      symbol: "sendMessage",
      line: 25,
      code: "anthropic.messages.create({...})",
    },
    {
      id: "conn-12",
      from: "src/workers/summarize.ts",
      to: "SUMMARIZE_PROMPT",
      type: "prompt-usage",
      symbol: "processSummarizeJob",
      line: 34,
      code: "claude.messages.create({ messages: [SYSTEM_PROMPT, ...] })",
    },
  ];

  return {
    connections,
    summary: buildSummary(connections),
  };
}
