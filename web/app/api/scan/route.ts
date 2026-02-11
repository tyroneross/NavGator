/**
 * API Route: /api/scan
 *
 * Triggers a NavGator scan and returns combined results.
 */

import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

interface ScanResponse {
  success: boolean;
  message: string;
  timestamp: string;
  results?: {
    components?: number;
    connections?: number;
    prompts?: number;
  };
  error?: string;
}

/**
 * POST /api/scan
 *
 * Triggers a full NavGator scan
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const projectPath = body.path || process.cwd().replace(/\/web$/, "");
    const includePrompts = body.prompts !== false;

    // Validate project path to prevent command injection
    if (!/^[a-zA-Z0-9._\s\/~-]+$/.test(projectPath)) {
      return NextResponse.json<ScanResponse>(
        { success: false, message: "Invalid project path", timestamp: new Date().toISOString(), error: "Path contains invalid characters" },
        { status: 400 }
      );
    }

    // Build the scan command
    let command = `cd "${projectPath}" && npx navgator scan`;
    if (includePrompts) {
      command += " --prompts";
    }

    // Run the scan
    const { stdout, stderr } = await execAsync(command, { timeout: 60000 });

    // Parse results from output
    const componentMatch = stdout.match(/Components:\s*(\d+)/);
    const connectionMatch = stdout.match(/Connections:\s*(\d+)/);
    const promptMatch = stdout.match(/Prompts:\s*(\d+)/);

    return NextResponse.json<ScanResponse>({
      success: true,
      message: "Scan completed successfully",
      timestamp: new Date().toISOString(),
      results: {
        components: componentMatch ? parseInt(componentMatch[1]) : undefined,
        connections: connectionMatch ? parseInt(connectionMatch[1]) : undefined,
        prompts: promptMatch ? parseInt(promptMatch[1]) : undefined,
      },
    });
  } catch (error) {
    console.error("Scan error:", error);

    return NextResponse.json<ScanResponse>(
      {
        success: false,
        message: "Scan failed",
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/scan
 *
 * Returns scan status/health
 */
export async function GET() {
  try {
    const projectPath = process.cwd().replace(/\/web$/, "");

    // Check if NavGator is available
    const { stdout } = await execAsync(`cd "${projectPath}" && npx navgator --version`, {
      timeout: 10000,
    });

    return NextResponse.json({
      available: true,
      version: stdout.trim(),
      projectPath,
    });
  } catch {
    return NextResponse.json({
      available: false,
      message: "NavGator CLI not available. Install with: npm install -g navgator",
    });
  }
}
