/**
 * CLI command module registration tests.
 * Verifies that each command module exports a register function, the function
 * attaches the correct sub-command to a Commander program, and that all 17
 * commands can coexist on a single program without name collisions.
 */

import { describe, it, expect } from 'vitest';
import { Command } from 'commander';

// ---------------------------------------------------------------------------
// Individual command registration
// ---------------------------------------------------------------------------

describe('CLI command modules', () => {
  it('scan command registers without error', async () => {
    const { registerScanCommand } = await import('../cli/commands/scan.js');
    const program = new Command();
    expect(() => registerScanCommand(program)).not.toThrow();
    const cmd = program.commands.find(c => c.name() === 'scan');
    expect(cmd).toBeDefined();
  });

  it('status command registers without error', async () => {
    const { registerStatusCommand } = await import('../cli/commands/status.js');
    const program = new Command();
    expect(() => registerStatusCommand(program)).not.toThrow();
    const cmd = program.commands.find(c => c.name() === 'status');
    expect(cmd).toBeDefined();
  });

  it('impact command registers without error', async () => {
    const { registerImpactCommand } = await import('../cli/commands/impact.js');
    const program = new Command();
    expect(() => registerImpactCommand(program)).not.toThrow();
    const cmd = program.commands.find(c => c.name() === 'impact');
    expect(cmd).toBeDefined();
  });

  it('connections command registers without error', async () => {
    const { registerConnectionsCommand } = await import('../cli/commands/connections.js');
    const program = new Command();
    expect(() => registerConnectionsCommand(program)).not.toThrow();
    const cmd = program.commands.find(c => c.name() === 'connections');
    expect(cmd).toBeDefined();
  });

  it('list command registers without error', async () => {
    const { registerListCommand } = await import('../cli/commands/list.js');
    const program = new Command();
    expect(() => registerListCommand(program)).not.toThrow();
    const cmd = program.commands.find(c => c.name() === 'list');
    expect(cmd).toBeDefined();
  });

  it('diagram command registers without error', async () => {
    const { registerDiagramCommand } = await import('../cli/commands/diagram.js');
    const program = new Command();
    expect(() => registerDiagramCommand(program)).not.toThrow();
    const cmd = program.commands.find(c => c.name() === 'diagram');
    expect(cmd).toBeDefined();
  });

  it('prompts command registers without error', async () => {
    const { registerPromptsCommand } = await import('../cli/commands/prompts.js');
    const program = new Command();
    expect(() => registerPromptsCommand(program)).not.toThrow();
    const cmd = program.commands.find(c => c.name() === 'prompts');
    expect(cmd).toBeDefined();
  });

  it('trace command registers without error', async () => {
    const { registerTraceCommand } = await import('../cli/commands/trace.js');
    const program = new Command();
    expect(() => registerTraceCommand(program)).not.toThrow();
    const cmd = program.commands.find(c => c.name() === 'trace');
    expect(cmd).toBeDefined();
  });

  it('rules command registers without error', async () => {
    const { registerRulesCommand } = await import('../cli/commands/rules.js');
    const program = new Command();
    expect(() => registerRulesCommand(program)).not.toThrow();
    const cmd = program.commands.find(c => c.name() === 'rules');
    expect(cmd).toBeDefined();
  });

  it('coverage command registers without error', async () => {
    const { registerCoverageCommand } = await import('../cli/commands/coverage.js');
    const program = new Command();
    expect(() => registerCoverageCommand(program)).not.toThrow();
    const cmd = program.commands.find(c => c.name() === 'coverage');
    expect(cmd).toBeDefined();
  });

  it('subgraph command registers without error', async () => {
    const { registerSubgraphCommand } = await import('../cli/commands/subgraph.js');
    const program = new Command();
    expect(() => registerSubgraphCommand(program)).not.toThrow();
    const cmd = program.commands.find(c => c.name() === 'subgraph');
    expect(cmd).toBeDefined();
  });

  // misc.ts exports multiple register functions
  it('setup command registers without error', async () => {
    const { registerSetupCommand } = await import('../cli/commands/misc.js');
    const program = new Command();
    expect(() => registerSetupCommand(program)).not.toThrow();
    const cmd = program.commands.find(c => c.name() === 'setup');
    expect(cmd).toBeDefined();
  });

  it('ui command registers without error', async () => {
    const { registerUICommand } = await import('../cli/commands/misc.js');
    const program = new Command();
    expect(() => registerUICommand(program)).not.toThrow();
    const cmd = program.commands.find(c => c.name() === 'ui');
    expect(cmd).toBeDefined();
  });

  it('history command registers without error', async () => {
    const { registerHistoryCommand } = await import('../cli/commands/misc.js');
    const program = new Command();
    expect(() => registerHistoryCommand(program)).not.toThrow();
    const cmd = program.commands.find(c => c.name() === 'history');
    expect(cmd).toBeDefined();
  });

  it('diff command registers without error', async () => {
    const { registerDiffCommand } = await import('../cli/commands/misc.js');
    const program = new Command();
    expect(() => registerDiffCommand(program)).not.toThrow();
    const cmd = program.commands.find(c => c.name() === 'diff');
    expect(cmd).toBeDefined();
  });

  it('projects command registers without error', async () => {
    const { registerProjectsCommand } = await import('../cli/commands/misc.js');
    const program = new Command();
    expect(() => registerProjectsCommand(program)).not.toThrow();
    const cmd = program.commands.find(c => c.name() === 'projects');
    expect(cmd).toBeDefined();
  });

  it('summary command registers without error', async () => {
    const { registerSummaryCommand } = await import('../cli/commands/misc.js');
    const program = new Command();
    expect(() => registerSummaryCommand(program)).not.toThrow();
    const cmd = program.commands.find(c => c.name() === 'summary');
    expect(cmd).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // All 17 commands on one program — collision and count checks
  // ---------------------------------------------------------------------------

  it('all 17 commands register on a single program without collisions', async () => {
    const [
      { registerScanCommand },
      { registerStatusCommand },
      { registerImpactCommand },
      { registerConnectionsCommand },
      { registerListCommand },
      { registerDiagramCommand },
      { registerPromptsCommand },
      { registerTraceCommand },
      { registerRulesCommand },
      { registerCoverageCommand },
      { registerSubgraphCommand },
      {
        registerSetupCommand,
        registerUICommand,
        registerHistoryCommand,
        registerDiffCommand,
        registerProjectsCommand,
        registerSummaryCommand,
      },
    ] = await Promise.all([
      import('../cli/commands/scan.js'),
      import('../cli/commands/status.js'),
      import('../cli/commands/impact.js'),
      import('../cli/commands/connections.js'),
      import('../cli/commands/list.js'),
      import('../cli/commands/diagram.js'),
      import('../cli/commands/prompts.js'),
      import('../cli/commands/trace.js'),
      import('../cli/commands/rules.js'),
      import('../cli/commands/coverage.js'),
      import('../cli/commands/subgraph.js'),
      import('../cli/commands/misc.js'),
    ]);

    const program = new Command();

    expect(() => {
      registerScanCommand(program);
      registerStatusCommand(program);
      registerImpactCommand(program);
      registerConnectionsCommand(program);
      registerListCommand(program);
      registerDiagramCommand(program);
      registerPromptsCommand(program);
      registerTraceCommand(program);
      registerRulesCommand(program);
      registerCoverageCommand(program);
      registerSubgraphCommand(program);
      registerSetupCommand(program);
      registerUICommand(program);
      registerHistoryCommand(program);
      registerDiffCommand(program);
      registerProjectsCommand(program);
      registerSummaryCommand(program);
    }).not.toThrow();

    expect(program.commands).toHaveLength(17);

    // No duplicate command names
    const names = program.commands.map(c => c.name());
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(17);
  });

  // ---------------------------------------------------------------------------
  // C8 integration — portfolio, scan-remote, arch-diff (docs/plans/
  // 2026-08-03-portfolio-remote-gitaware.md)
  // ---------------------------------------------------------------------------

  it('portfolio command registers without error', async () => {
    const { registerPortfolioCommand } = await import('../cli/commands/portfolio.js');
    const program = new Command();
    expect(() => registerPortfolioCommand(program)).not.toThrow();
    const cmd = program.commands.find(c => c.name() === 'portfolio');
    expect(cmd).toBeDefined();
  });

  it('scan-remote command registers without error', async () => {
    const { registerScanRemoteCommand } = await import('../cli/commands/remote.js');
    const program = new Command();
    expect(() => registerScanRemoteCommand(program)).not.toThrow();
    const cmd = program.commands.find(c => c.name() === 'scan-remote');
    expect(cmd).toBeDefined();
  });

  it('arch-diff command registers without error', async () => {
    const { registerArchDiffCommand } = await import('../cli/commands/arch-diff.js');
    const program = new Command();
    expect(() => registerArchDiffCommand(program)).not.toThrow();
    const cmd = program.commands.find(c => c.name() === 'arch-diff');
    expect(cmd).toBeDefined();
  });

  // C5 — navgator doctor: registry + memory hygiene
  it('doctor command registers without error', async () => {
    const { registerDoctorCommand } = await import('../cli/commands/doctor.js');
    const program = new Command();
    expect(() => registerDoctorCommand(program)).not.toThrow();
    const cmd = program.commands.find(c => c.name() === 'doctor');
    expect(cmd).toBeDefined();
  });

  it('portfolio, scan-remote, and arch-diff coexist with the original 17 without collisions', async () => {
    const [
      { registerScanCommand },
      { registerStatusCommand },
      { registerImpactCommand },
      { registerConnectionsCommand },
      { registerListCommand },
      { registerDiagramCommand },
      { registerPromptsCommand },
      { registerTraceCommand },
      { registerRulesCommand },
      { registerCoverageCommand },
      { registerSubgraphCommand },
      {
        registerSetupCommand,
        registerUICommand,
        registerHistoryCommand,
        registerDiffCommand,
        registerProjectsCommand,
        registerSummaryCommand,
      },
      { registerPortfolioCommand },
      { registerScanRemoteCommand },
      { registerArchDiffCommand },
    ] = await Promise.all([
      import('../cli/commands/scan.js'),
      import('../cli/commands/status.js'),
      import('../cli/commands/impact.js'),
      import('../cli/commands/connections.js'),
      import('../cli/commands/list.js'),
      import('../cli/commands/diagram.js'),
      import('../cli/commands/prompts.js'),
      import('../cli/commands/trace.js'),
      import('../cli/commands/rules.js'),
      import('../cli/commands/coverage.js'),
      import('../cli/commands/subgraph.js'),
      import('../cli/commands/misc.js'),
      import('../cli/commands/portfolio.js'),
      import('../cli/commands/remote.js'),
      import('../cli/commands/arch-diff.js'),
    ]);

    const program = new Command();

    expect(() => {
      registerScanCommand(program);
      registerStatusCommand(program);
      registerImpactCommand(program);
      registerConnectionsCommand(program);
      registerListCommand(program);
      registerDiagramCommand(program);
      registerPromptsCommand(program);
      registerTraceCommand(program);
      registerRulesCommand(program);
      registerCoverageCommand(program);
      registerSubgraphCommand(program);
      registerSetupCommand(program);
      registerUICommand(program);
      registerHistoryCommand(program);
      registerDiffCommand(program);
      registerProjectsCommand(program);
      registerSummaryCommand(program);
      registerPortfolioCommand(program);
      registerScanRemoteCommand(program);
      registerArchDiffCommand(program);
    }).not.toThrow();

    expect(program.commands).toHaveLength(20);

    const names = program.commands.map(c => c.name());
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(20);
    expect(names).toContain('portfolio');
    expect(names).toContain('scan-remote');
    expect(names).toContain('arch-diff');
  });
});

// ---------------------------------------------------------------------------
// MCP tools
// ---------------------------------------------------------------------------

describe('MCP tools', () => {
  it('TOOLS array has expected tools', async () => {
    const { TOOLS } = await import('../mcp/tools.js');
    const names = TOOLS.map(t => t.name);
    expect(names).toContain('scan');
    expect(names).toContain('status');
    expect(names).toContain('review');
    expect(names).toContain('explore');
    expect(names).toContain('rules');
    expect(names).toContain('impact');
    expect(names).toContain('connections');
    expect(names).toContain('diagram');
    expect(names).toContain('trace');
    expect(names).toContain('summary');
  });

  it('all tools have required fields', async () => {
    const { TOOLS } = await import('../mcp/tools.js');
    for (const tool of TOOLS) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
      expect(tool.annotations).toBeDefined();
      expect(tool.annotations.readOnlyHint).toBeDefined();
    }
  });

  // C8 integration — portfolio and arch_diff added, scan_remote deliberately
  // withheld (docs/plans/2026-08-03-portfolio-remote-gitaware.md, Surface decision)
  it('TOOLS array includes portfolio and arch_diff, and exactly 12 tools total', async () => {
    const { TOOLS } = await import('../mcp/tools.js');
    const names = TOOLS.map(t => t.name);
    expect(names).toContain('portfolio');
    expect(names).toContain('arch_diff');
    expect(names).not.toContain('scan_remote');
    expect(TOOLS).toHaveLength(12);
  });

  it('handleToolCall has a case for portfolio and arch_diff', async () => {
    const { TOOLS, handleToolCall } = await import('../mcp/tools.js');
    expect(TOOLS.length).toBe(12);
    const unknown = await handleToolCall('not-a-real-tool', {});
    expect(unknown.isError).toBe(true);
    // A real dispatch (not the unknown-tool fallthrough) proves the switch has cases
    // for the two new names — either they run cleanly or throw inside their own
    // handler (caught and turned into an error response), never the generic
    // "Unknown tool" message.
    const portfolioResult = await handleToolCall('portfolio', {});
    expect(portfolioResult.content[0].text).not.toBe('Unknown tool: portfolio');
    const archDiffResult = await handleToolCall('arch_diff', {});
    expect(archDiffResult.content[0].text).not.toBe('Unknown tool: arch_diff');
  });
});
