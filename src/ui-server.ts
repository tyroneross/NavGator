/**
 * NavGator UI Server (DISABLED)
 *
 * The built-in vanilla HTML dashboard has been replaced by the Next.js web app.
 * Use `navgator ui` to launch the full dashboard.
 *
 * This file is kept as a stub so existing imports don't break.
 */

export async function startUIServer(_options: {
  port?: number;
  projectPath?: string;
  open?: boolean;
}): Promise<{ port: number; close: () => void }> {
  throw new Error(
    'The built-in UI server has been replaced by the Next.js dashboard.\n' +
    'Run `navgator ui` to launch the full dashboard.'
  );
}

// =============================================================================
// ORIGINAL IMPLEMENTATION (disabled, not deleted)
// =============================================================================

/*
import * as http from 'http';
import { loadIndex, loadAllComponents, loadAllConnections, loadGraph } from './storage.js';
import { getConfig } from './config.js';

const DEFAULT_PORT = 3333;

export async function startUIServer(options: {
  port?: number;
  projectPath?: string;
  open?: boolean;
}): Promise<{ port: number; close: () => void }> {
  const port = options.port || DEFAULT_PORT;
  const projectPath = options.projectPath || process.cwd();
  const config = getConfig();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    try {
      if (url.pathname === '/api/status') {
        const index = await loadIndex(config, projectPath);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(index || { error: 'No scan data. Run: navgator setup' }));
        return;
      }

      if (url.pathname === '/api/components') {
        const components = await loadAllComponents(config, projectPath);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(components));
        return;
      }

      if (url.pathname === '/api/connections') {
        const connections = await loadAllConnections(config, projectPath);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(connections));
        return;
      }

      if (url.pathname === '/api/graph') {
        const graph = await loadGraph(config, projectPath);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(graph || { nodes: [], edges: [] }));
        return;
      }

      if (url.pathname === '/' || url.pathname === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(generateDashboardHTML(projectPath));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(error) }));
    }
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      resolve({
        port,
        close: () => server.close(),
      });
    });
  });
}

function generateDashboardHTML(projectPath: string): string {
  // ~700 lines of vanilla HTML dashboard omitted
  return '<!DOCTYPE html><html><body>Dashboard disabled</body></html>';
}
*/
