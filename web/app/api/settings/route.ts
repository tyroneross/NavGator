/**
 * API Route: /api/settings
 *
 * Loads and saves NavGator settings to .claude/settings.json
 */

import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs/promises";
import * as path from "path";

interface SettingsData {
  scan: {
    rootPath: string;
    excludePaths: string[];
    includePatterns: string[];
    scanDepth: number;
    watchMode: boolean;
    autoScanOnChange: boolean;
  };
  detection: {
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
  };
  notifications: {
    enabled: boolean;
    onNewConnection: boolean;
    onBreakingChange: boolean;
    onSecurityIssue: boolean;
    slackWebhook: string;
  };
  display: {
    theme: "dark" | "light" | "system";
    compactMode: boolean;
    showLineNumbers: boolean;
    diagramDirection: "TB" | "LR";
    maxVisibleConnections: number;
  };
  lastSaved?: number;
}

const DEFAULTS: SettingsData = {
  scan: {
    rootPath: "./src",
    excludePaths: ["node_modules", ".git", "dist", "build", ".next"],
    includePatterns: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"],
    scanDepth: 10,
    watchMode: false,
    autoScanOnChange: true,
  },
  detection: {
    npm: true,
    database: true,
    service: true,
    queue: true,
    cache: true,
    storage: true,
    auth: true,
    llm: true,
    staticAnalysis: true,
    environmentVariables: true,
    configFiles: true,
  },
  notifications: {
    enabled: true,
    onNewConnection: false,
    onBreakingChange: true,
    onSecurityIssue: true,
    slackWebhook: "",
  },
  display: {
    theme: "dark",
    compactMode: false,
    showLineNumbers: true,
    diagramDirection: "TB",
    maxVisibleConnections: 50,
  },
};

let cachedData: SettingsData | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 30000;

function getSettingsPath(projectPath?: string | null): string {
  const root =
    projectPath ||
    process.env.NAVGATOR_PROJECT_PATH ||
    process.cwd().replace(/\/web$/, "");
  return path.join(root, ".claude", "settings.json");
}

async function loadSettings(
  projectPath?: string | null
): Promise<{ data: SettingsData; source: "local" | "default" }> {
  const settingsPath = getSettingsPath(projectPath);
  try {
    const content = await fs.readFile(settingsPath, "utf-8");
    const parsed = JSON.parse(content) as SettingsData;
    // Merge with defaults to fill any missing keys
    return {
      data: {
        scan: { ...DEFAULTS.scan, ...parsed.scan },
        detection: { ...DEFAULTS.detection, ...parsed.detection },
        notifications: { ...DEFAULTS.notifications, ...parsed.notifications },
        display: { ...DEFAULTS.display, ...parsed.display },
        lastSaved: parsed.lastSaved,
      },
      source: "local",
    };
  } catch {
    return { data: { ...DEFAULTS }, source: "default" };
  }
}

/**
 * GET /api/settings
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const refresh = searchParams.get("refresh") === "true";
  const projectPath = searchParams.get("path");

  if (!refresh && cachedData && Date.now() - cacheTimestamp < CACHE_TTL) {
    return NextResponse.json({
      success: true,
      data: cachedData,
      source: "cache",
    });
  }

  try {
    const { data, source } = await loadSettings(projectPath);
    cachedData = data;
    cacheTimestamp = Date.now();

    return NextResponse.json({ success: true, data, source });
  } catch (error) {
    return NextResponse.json({
      success: false,
      data: DEFAULTS,
      source: "default",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

/**
 * POST /api/settings
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const projectPath = body.projectPath || null;
    const settingsPath = getSettingsPath(projectPath);

    // Load existing, merge with incoming
    const { data: existing } = await loadSettings(projectPath);
    const merged: SettingsData = {
      scan: body.scan ? { ...existing.scan, ...body.scan } : existing.scan,
      detection: body.detection
        ? { ...existing.detection, ...body.detection }
        : existing.detection,
      notifications: body.notifications
        ? { ...existing.notifications, ...body.notifications }
        : existing.notifications,
      display: body.display
        ? { ...existing.display, ...body.display }
        : existing.display,
      lastSaved: Date.now(),
    };

    // Ensure directory exists
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(settingsPath, JSON.stringify(merged, null, 2));

    // Invalidate cache
    cachedData = merged;
    cacheTimestamp = Date.now();

    return NextResponse.json({ success: true, data: merged });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to save",
      },
      { status: 500 }
    );
  }
}
