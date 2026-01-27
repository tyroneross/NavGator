/**
 * NavGator UI Server
 * Built-in dashboard server for viewing architecture data
 * All data comes from real scans - no mock data
 */

import * as http from 'http';
import { loadIndex, loadAllComponents, loadAllConnections, loadGraph } from './storage.js';
import { getConfig } from './config.js';

const DEFAULT_PORT = 3333;

/**
 * Start the UI server
 */
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

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    try {
      // API endpoints - all return REAL data from scans
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

      // Serve dashboard HTML
      if (url.pathname === '/' || url.pathname === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(generateDashboardHTML(projectPath));
        return;
      }

      // 404
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

/**
 * Generate the dashboard HTML - fully functional, real data only
 */
function generateDashboardHTML(projectPath: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NavGator Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a;
      color: #e5e5e5;
      min-height: 100vh;
    }
    .header {
      background: #171717;
      border-bottom: 1px solid #262626;
      padding: 12px 24px;
      display: flex;
      align-items: center;
      gap: 12px;
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .header h1 {
      font-size: 18px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .nav {
      display: flex;
      gap: 4px;
      margin-left: 32px;
    }
    .nav-btn {
      background: transparent;
      border: none;
      color: #737373;
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      transition: all 0.15s;
    }
    .nav-btn:hover { color: #e5e5e5; background: #262626; }
    .nav-btn.active { color: #22c55e; background: #22c55e15; }
    .header-right {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .search-box {
      background: #262626;
      border: 1px solid #404040;
      color: #e5e5e5;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 14px;
      width: 240px;
    }
    .search-box:focus { outline: none; border-color: #22c55e; }
    .refresh-btn {
      background: #262626;
      border: 1px solid #404040;
      color: #e5e5e5;
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
    }
    .refresh-btn:hover { background: #333; }
    .container { max-width: 1400px; margin: 0 auto; padding: 24px; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .card {
      background: #171717;
      border: 1px solid #262626;
      border-radius: 8px;
      padding: 20px;
    }
    .card h2 {
      font-size: 12px;
      font-weight: 500;
      color: #737373;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .stat { font-size: 32px; font-weight: 700; color: #22c55e; }
    .stat-label { font-size: 13px; color: #525252; margin-top: 4px; }
    .list { list-style: none; }
    .list li {
      padding: 10px 0;
      border-bottom: 1px solid #262626;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: pointer;
      transition: background 0.1s;
      margin: 0 -20px;
      padding-left: 20px;
      padding-right: 20px;
    }
    .list li:hover { background: #1f1f1f; }
    .list li:last-child { border-bottom: none; }
    .badge {
      background: #262626;
      padding: 3px 10px;
      border-radius: 4px;
      font-size: 12px;
      color: #a3a3a3;
      font-weight: 500;
    }
    .badge.npm { background: #7c3aed20; color: #a78bfa; }
    .badge.service { background: #3b82f620; color: #60a5fa; }
    .badge.database { background: #22c55e20; color: #4ade80; }
    .badge.queue { background: #f59e0b20; color: #fbbf24; }
    .badge.infra { background: #ec489920; color: #f472b6; }
    .badge.prompt { background: #06b6d420; color: #22d3ee; }
    .section { margin-bottom: 24px; }
    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
    }
    .section-title { font-size: 16px; font-weight: 600; }
    .filter-group { display: flex; gap: 8px; }
    .filter-btn {
      background: #262626;
      border: 1px solid #333;
      color: #a3a3a3;
      padding: 6px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    }
    .filter-btn:hover, .filter-btn.active { background: #333; color: #e5e5e5; }
    .table { width: 100%; border-collapse: collapse; }
    .table th, .table td { text-align: left; padding: 12px 16px; border-bottom: 1px solid #262626; }
    .table th { color: #525252; font-weight: 500; font-size: 11px; text-transform: uppercase; background: #0f0f0f; position: sticky; top: 0; }
    .table tr { cursor: pointer; transition: background 0.1s; }
    .table tr:hover td { background: #1a1a1a; }
    .table-wrapper { max-height: 500px; overflow-y: auto; border-radius: 8px; border: 1px solid #262626; }
    .loading, .empty { text-align: center; padding: 60px 20px; color: #525252; }
    .empty h2 { color: #737373; margin-bottom: 12px; }
    .empty code { background: #262626; padding: 4px 12px; border-radius: 4px; font-family: monospace; color: #22c55e; }
    .file-path { font-family: 'SF Mono', Monaco, monospace; font-size: 12px; color: #a3a3a3; }
    .code-snippet { font-family: 'SF Mono', Monaco, monospace; font-size: 11px; color: #525252; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .detail-panel {
      position: fixed;
      top: 0;
      right: 0;
      width: 480px;
      height: 100vh;
      background: #171717;
      border-left: 1px solid #262626;
      transform: translateX(100%);
      transition: transform 0.2s ease;
      z-index: 200;
      overflow-y: auto;
    }
    .detail-panel.open { transform: translateX(0); }
    .detail-header {
      padding: 20px;
      border-bottom: 1px solid #262626;
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 0;
      background: #171717;
    }
    .detail-header h3 { font-size: 16px; font-weight: 600; }
    .close-btn {
      background: none;
      border: none;
      color: #737373;
      font-size: 24px;
      cursor: pointer;
      padding: 4px 8px;
    }
    .close-btn:hover { color: #e5e5e5; }
    .detail-content { padding: 20px; }
    .detail-section { margin-bottom: 24px; }
    .detail-section h4 { font-size: 12px; color: #525252; text-transform: uppercase; margin-bottom: 12px; }
    .detail-item { padding: 12px; background: #0f0f0f; border-radius: 6px; margin-bottom: 8px; }
    .detail-item .label { font-size: 11px; color: #525252; margin-bottom: 4px; }
    .detail-item .value { font-size: 14px; color: #e5e5e5; }
    .connection-item {
      padding: 12px;
      background: #0f0f0f;
      border-radius: 6px;
      margin-bottom: 8px;
      border-left: 3px solid #22c55e;
    }
    .connection-item.incoming { border-left-color: #3b82f6; }
    .connection-item .file { font-family: monospace; font-size: 12px; color: #a3a3a3; }
    .connection-item .type { font-size: 11px; color: #525252; margin-top: 4px; }
    .hidden { display: none; }
    .project-path { font-size: 12px; color: #525252; margin-left: 8px; font-family: monospace; }
    @media (max-width: 768px) {
      .nav { display: none; }
      .search-box { width: 160px; }
      .detail-panel { width: 100%; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>🐊 NavGator</h1>
    <span class="project-path">${projectPath}</span>
    <nav class="nav">
      <button class="nav-btn active" data-view="overview">Overview</button>
      <button class="nav-btn" data-view="components">Components</button>
      <button class="nav-btn" data-view="connections">Connections</button>
      <button class="nav-btn" data-view="impact">Impact</button>
    </nav>
    <div class="header-right">
      <input type="text" class="search-box" placeholder="Search components..." id="searchInput">
      <button class="refresh-btn" onclick="loadData()">↻ Refresh</button>
    </div>
  </div>

  <div class="container">
    <div id="content"><div class="loading">Loading architecture data...</div></div>
  </div>

  <div class="detail-panel" id="detailPanel">
    <div class="detail-header">
      <h3 id="detailTitle">Component Details</h3>
      <button class="close-btn" onclick="closeDetail()">×</button>
    </div>
    <div class="detail-content" id="detailContent"></div>
  </div>

  <script>
    let components = [];
    let connections = [];
    let status = {};
    let currentView = 'overview';
    let selectedComponent = null;
    let searchQuery = '';
    let typeFilter = 'all';

    // Navigation
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentView = btn.dataset.view;
        render();
      });
    });

    // Search
    document.getElementById('searchInput').addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase();
      render();
    });

    // Load data from API (REAL data only)
    async function loadData() {
      const content = document.getElementById('content');
      content.innerHTML = '<div class="loading">Loading...</div>';

      try {
        const [statusRes, componentsRes, connectionsRes] = await Promise.all([
          fetch('/api/status'),
          fetch('/api/components'),
          fetch('/api/connections'),
        ]);

        status = await statusRes.json();
        components = await componentsRes.json();
        connections = await connectionsRes.json();

        if (status.error || components.length === 0) {
          content.innerHTML = \`
            <div class="empty">
              <h2>No Architecture Data</h2>
              <p>Run <code>navgator setup</code> to scan this project.</p>
            </div>
          \`;
          return;
        }

        render();
      } catch (error) {
        content.innerHTML = \`<div class="empty"><h2>Error</h2><p>\${error.message}</p></div>\`;
      }
    }

    // Render current view
    function render() {
      const content = document.getElementById('content');

      switch(currentView) {
        case 'overview': content.innerHTML = renderOverview(); break;
        case 'components': content.innerHTML = renderComponents(); break;
        case 'connections': content.innerHTML = renderConnections(); break;
        case 'impact': content.innerHTML = renderImpact(); break;
      }

      // Attach event listeners
      document.querySelectorAll('[data-component]').forEach(el => {
        el.addEventListener('click', () => showComponentDetail(el.dataset.component));
      });
      document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          typeFilter = btn.dataset.type;
          document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          render();
        });
      });
    }

    // Overview view
    function renderOverview() {
      const byType = {};
      components.forEach(c => { byType[c.type] = (byType[c.type] || 0) + 1; });

      const connByType = {};
      connections.forEach(c => { connByType[c.connection_type] = (connByType[c.connection_type] || 0) + 1; });

      const lastScan = status.last_scan ? new Date(status.last_scan).toLocaleString() : 'Never';

      return \`
        <div class="grid">
          <div class="card">
            <h2>Components</h2>
            <div class="stat">\${components.length}</div>
            <div class="stat-label">Tracked in this project</div>
          </div>
          <div class="card">
            <h2>Connections</h2>
            <div class="stat">\${connections.length}</div>
            <div class="stat-label">Mapped relationships</div>
          </div>
          <div class="card">
            <h2>Last Scan</h2>
            <div class="stat" style="font-size: 16px; color: #e5e5e5;">\${lastScan}</div>
            <div class="stat-label">Run navgator scan to refresh</div>
          </div>
        </div>
        <div class="grid">
          <div class="card">
            <h2>Components by Type</h2>
            <ul class="list">
              \${Object.entries(byType).sort((a,b) => b[1] - a[1]).map(([type, count]) => \`
                <li><span>\${type}</span><span class="badge \${type}">\${count}</span></li>
              \`).join('')}
            </ul>
          </div>
          <div class="card">
            <h2>Connections by Type</h2>
            <ul class="list">
              \${Object.entries(connByType).sort((a,b) => b[1] - a[1]).map(([type, count]) => \`
                <li><span>\${type.replace(/-/g, ' ')}</span><span class="badge">\${count}</span></li>
              \`).join('')}
            </ul>
          </div>
          <div class="card">
            <h2>Quick Actions</h2>
            <ul class="list">
              <li onclick="currentView='components';document.querySelector('[data-view=components]').click()">
                <span>Browse all components</span><span>→</span>
              </li>
              <li onclick="currentView='connections';document.querySelector('[data-view=connections]').click()">
                <span>View connections</span><span>→</span>
              </li>
              <li onclick="currentView='impact';document.querySelector('[data-view=impact]').click()">
                <span>Impact analysis</span><span>→</span>
              </li>
            </ul>
          </div>
        </div>
      \`;
    }

    // Components view
    function renderComponents() {
      const types = [...new Set(components.map(c => c.type))];
      let filtered = components;

      if (searchQuery) {
        filtered = filtered.filter(c =>
          c.name.toLowerCase().includes(searchQuery) ||
          c.type.toLowerCase().includes(searchQuery) ||
          (c.role?.purpose || '').toLowerCase().includes(searchQuery)
        );
      }
      if (typeFilter !== 'all') {
        filtered = filtered.filter(c => c.type === typeFilter);
      }

      return \`
        <div class="section">
          <div class="section-header">
            <div class="section-title">All Components (\${filtered.length})</div>
            <div class="filter-group">
              <button class="filter-btn \${typeFilter === 'all' ? 'active' : ''}" data-type="all">All</button>
              \${types.map(t => \`<button class="filter-btn \${typeFilter === t ? 'active' : ''}" data-type="\${t}">\${t}</button>\`).join('')}
            </div>
          </div>
          <div class="table-wrapper">
            <table class="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Layer</th>
                  <th>Version</th>
                  <th>Purpose</th>
                  <th>Connections</th>
                </tr>
              </thead>
              <tbody>
                \${filtered.map(c => {
                  const connCount = connections.filter(conn =>
                    conn.to?.component_id === c.component_id ||
                    conn.from?.component_id === c.component_id
                  ).length;
                  return \`
                    <tr data-component="\${c.component_id}">
                      <td><strong>\${c.name}</strong></td>
                      <td><span class="badge \${c.type}">\${c.type}</span></td>
                      <td>\${c.role?.layer || '-'}</td>
                      <td>\${c.version || '-'}</td>
                      <td style="color: #737373; font-size: 13px;">\${c.role?.purpose || '-'}</td>
                      <td><span class="badge">\${connCount}</span></td>
                    </tr>
                  \`;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      \`;
    }

    // Connections view
    function renderConnections() {
      let filtered = connections;

      if (searchQuery) {
        filtered = filtered.filter(c =>
          (c.code_reference?.file || '').toLowerCase().includes(searchQuery) ||
          (c.to?.component_id || '').toLowerCase().includes(searchQuery) ||
          (c.connection_type || '').toLowerCase().includes(searchQuery)
        );
      }

      return \`
        <div class="section">
          <div class="section-header">
            <div class="section-title">All Connections (\${filtered.length})</div>
          </div>
          <div class="table-wrapper">
            <table class="table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Line</th>
                  <th>Type</th>
                  <th>Target</th>
                  <th>Code</th>
                </tr>
              </thead>
              <tbody>
                \${filtered.slice(0, 100).map(c => {
                  const target = components.find(comp => comp.component_id === c.to?.component_id);
                  return \`
                    <tr>
                      <td class="file-path">\${c.code_reference?.file || '-'}</td>
                      <td>\${c.code_reference?.line_start || '-'}</td>
                      <td><span class="badge">\${c.connection_type}</span></td>
                      <td>\${target?.name || c.to?.component_id?.replace('COMP_', '') || '-'}</td>
                      <td class="code-snippet">\${c.code_reference?.code_snippet || '-'}</td>
                    </tr>
                  \`;
                }).join('')}
              </tbody>
            </table>
            \${filtered.length > 100 ? '<p style="padding: 16px; color: #525252; text-align: center;">Showing 100 of ' + filtered.length + ' connections</p>' : ''}
          </div>
        </div>
      \`;
    }

    // Impact view
    function renderImpact() {
      if (!selectedComponent) {
        return \`
          <div class="section">
            <div class="section-header">
              <div class="section-title">Impact Analysis</div>
            </div>
            <div class="card">
              <p style="color: #737373; text-align: center; padding: 40px;">
                Select a component to see what would be affected if you change it.
              </p>
              <div class="grid" style="margin-top: 20px;">
                \${components.slice(0, 12).map(c => \`
                  <div class="detail-item" style="cursor: pointer;" onclick="selectForImpact('\${c.component_id}')">
                    <div class="value">\${c.name}</div>
                    <div class="label">\${c.type} · \${c.role?.layer || 'unknown'}</div>
                  </div>
                \`).join('')}
              </div>
            </div>
          </div>
        \`;
      }

      const comp = components.find(c => c.component_id === selectedComponent);
      const incoming = connections.filter(c => c.to?.component_id === selectedComponent);
      const outgoing = connections.filter(c => c.from?.component_id === selectedComponent);

      return \`
        <div class="section">
          <div class="section-header">
            <div class="section-title">Impact Analysis: \${comp?.name || selectedComponent}</div>
            <button class="filter-btn" onclick="selectedComponent=null;render()">← Back</button>
          </div>

          <div class="grid">
            <div class="card">
              <h2>Incoming (\${incoming.length})</h2>
              <p style="color: #525252; font-size: 13px; margin-bottom: 16px;">These files USE this component</p>
              \${incoming.length === 0 ? '<p style="color: #404040;">No incoming connections</p>' : ''}
              \${incoming.slice(0, 20).map(c => \`
                <div class="connection-item incoming">
                  <div class="file">\${c.code_reference?.file}:\${c.code_reference?.line_start}</div>
                  <div class="type">\${c.connection_type} · \${c.code_reference?.symbol || ''}</div>
                </div>
              \`).join('')}
              \${incoming.length > 20 ? '<p style="color: #525252; margin-top: 12px;">+ ' + (incoming.length - 20) + ' more</p>' : ''}
            </div>

            <div class="card">
              <h2>Outgoing (\${outgoing.length})</h2>
              <p style="color: #525252; font-size: 13px; margin-bottom: 16px;">This component DEPENDS on these</p>
              \${outgoing.length === 0 ? '<p style="color: #404040;">No outgoing connections</p>' : ''}
              \${outgoing.slice(0, 20).map(c => {
                const target = components.find(comp => comp.component_id === c.to?.component_id);
                return \`
                  <div class="connection-item">
                    <div class="file">\${target?.name || c.to?.component_id}</div>
                    <div class="type">\${c.connection_type}</div>
                  </div>
                \`;
              }).join('')}
            </div>
          </div>

          <div class="card" style="margin-top: 16px;">
            <h2>Files That May Need Changes</h2>
            <p style="color: #525252; font-size: 13px; margin-bottom: 16px;">If you modify \${comp?.name}, check these files:</p>
            <div class="table-wrapper" style="max-height: 300px;">
              <table class="table">
                <thead><tr><th>File</th><th>Line</th><th>Function</th></tr></thead>
                <tbody>
                  \${[...new Map(incoming.map(c => [c.code_reference?.file, c])).values()].map(c => \`
                    <tr>
                      <td class="file-path">\${c.code_reference?.file}</td>
                      <td>\${c.code_reference?.line_start}</td>
                      <td>\${c.code_reference?.symbol || '-'}</td>
                    </tr>
                  \`).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      \`;
    }

    function selectForImpact(componentId) {
      selectedComponent = componentId;
      render();
    }

    // Show component detail panel
    function showComponentDetail(componentId) {
      const comp = components.find(c => c.component_id === componentId);
      if (!comp) return;

      const incoming = connections.filter(c => c.to?.component_id === componentId);
      const outgoing = connections.filter(c => c.from?.component_id === componentId);

      document.getElementById('detailTitle').textContent = comp.name;
      document.getElementById('detailContent').innerHTML = \`
        <div class="detail-section">
          <h4>Details</h4>
          <div class="detail-item">
            <div class="label">Type</div>
            <div class="value"><span class="badge \${comp.type}">\${comp.type}</span></div>
          </div>
          <div class="detail-item">
            <div class="label">Layer</div>
            <div class="value">\${comp.role?.layer || '-'}</div>
          </div>
          \${comp.version ? \`<div class="detail-item"><div class="label">Version</div><div class="value">\${comp.version}</div></div>\` : ''}
          \${comp.role?.purpose ? \`<div class="detail-item"><div class="label">Purpose</div><div class="value">\${comp.role.purpose}</div></div>\` : ''}
        </div>

        <div class="detail-section">
          <h4>Incoming Connections (\${incoming.length})</h4>
          \${incoming.length === 0 ? '<p style="color: #404040;">None</p>' : ''}
          \${incoming.slice(0, 10).map(c => \`
            <div class="connection-item incoming">
              <div class="file">\${c.code_reference?.file}:\${c.code_reference?.line_start}</div>
              <div class="type">\${c.connection_type}</div>
            </div>
          \`).join('')}
          \${incoming.length > 10 ? '<p style="color: #525252;">+ ' + (incoming.length - 10) + ' more</p>' : ''}
        </div>

        <div class="detail-section">
          <h4>Outgoing Connections (\${outgoing.length})</h4>
          \${outgoing.length === 0 ? '<p style="color: #404040;">None</p>' : ''}
          \${outgoing.slice(0, 10).map(c => {
            const target = components.find(comp => comp.component_id === c.to?.component_id);
            return \`
              <div class="connection-item">
                <div class="file">\${target?.name || c.to?.component_id}</div>
                <div class="type">\${c.connection_type}</div>
              </div>
            \`;
          }).join('')}
        </div>

        <button class="refresh-btn" style="width: 100%; margin-top: 16px;" onclick="selectedComponent='\${componentId}';currentView='impact';document.querySelector('[data-view=impact]').click();closeDetail();">
          View Full Impact Analysis →
        </button>
      \`;

      document.getElementById('detailPanel').classList.add('open');
    }

    function closeDetail() {
      document.getElementById('detailPanel').classList.remove('open');
    }

    // Close panel on escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeDetail();
    });

    // Initial load
    loadData();
  </script>
</body>
</html>`;
}
