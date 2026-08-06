import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  getBuiltinRules,
  checkRules,
  countComponentsPerRule,
  detectRuleDegeneracy,
  formatRulesOutput,
  RULE_DEGENERACY_MIN_POPULATION,
  ArchitectureRule,
  RuleViolation,
} from '../rules.js';
import { createComponent, createConnection } from './helpers.js';

describe('Architecture Rules', () => {
  describe('orphan-component', () => {
    it('should detect component with no connections', () => {
      const comp1 = createComponent({ name: 'OrphanComp', layer: 'frontend' });
      const comp2 = createComponent({ name: 'ConnectedComp', layer: 'backend' });
      const conn = createConnection(comp2.component_id, comp2.component_id);

      const rules = getBuiltinRules();
      const orphanRule = rules.find(r => r.id === 'orphan-component')!;
      const violations = orphanRule.check([comp1, comp2], [conn]);

      expect(violations).toHaveLength(1);
      expect(violations[0].rule_id).toBe('orphan-component');
      expect(violations[0].severity).toBe('warning');
      expect(violations[0].component).toBe('OrphanComp');
      expect(violations[0].message).toContain('has no connections');
    });

    it('should not flag component with connections', () => {
      const comp1 = createComponent({ name: 'Frontend', layer: 'frontend' });
      const comp2 = createComponent({ name: 'Backend', layer: 'backend' });
      const conn = createConnection(comp1.component_id, comp2.component_id);

      const rules = getBuiltinRules();
      const orphanRule = rules.find(r => r.id === 'orphan-component')!;
      const violations = orphanRule.check([comp1, comp2], [conn]);

      expect(violations).toHaveLength(0);
    });
  });

  describe('database-no-backend', () => {
    it('should detect database without backend connection', () => {
      const db = createComponent({ name: 'PostgreSQL', layer: 'database' });
      const frontend = createComponent({ name: 'React', layer: 'frontend' });

      const rules = getBuiltinRules();
      const dbRule = rules.find(r => r.id === 'database-no-backend')!;
      const violations = dbRule.check([db, frontend], []);

      expect(violations).toHaveLength(1);
      expect(violations[0].rule_id).toBe('database-no-backend');
      expect(violations[0].severity).toBe('warning');
      expect(violations[0].component).toBe('PostgreSQL');
      expect(violations[0].message).toContain('no incoming connections from backend');
    });

    it('should not flag database with backend connection', () => {
      const db = createComponent({ name: 'PostgreSQL', layer: 'database' });
      const backend = createComponent({ name: 'Express', layer: 'backend' });
      const conn = createConnection(backend.component_id, db.component_id);

      const rules = getBuiltinRules();
      const dbRule = rules.find(r => r.id === 'database-no-backend')!;
      const violations = dbRule.check([db, backend], [conn]);

      expect(violations).toHaveLength(0);
    });
  });

  describe('frontend-direct-db', () => {
    it('should detect frontend connecting directly to database', () => {
      const frontend = createComponent({ name: 'React', layer: 'frontend' });
      const db = createComponent({ name: 'PostgreSQL', layer: 'database' });
      const conn = createConnection(frontend.component_id, db.component_id);

      const rules = getBuiltinRules();
      const directDbRule = rules.find(r => r.id === 'frontend-direct-db')!;
      const violations = directDbRule.check([frontend, db], [conn]);

      expect(violations).toHaveLength(1);
      expect(violations[0].rule_id).toBe('frontend-direct-db');
      expect(violations[0].severity).toBe('error');
      expect(violations[0].component).toBe('React');
      expect(violations[0].message).toContain('connects directly to');
      expect(violations[0].message).toContain('database');
      expect(violations[0].suggestion).toContain('backend API layer');
    });

    it('should not flag frontend connecting to backend', () => {
      const frontend = createComponent({ name: 'React', layer: 'frontend' });
      const backend = createComponent({ name: 'Express', layer: 'backend' });
      const conn = createConnection(frontend.component_id, backend.component_id);

      const rules = getBuiltinRules();
      const directDbRule = rules.find(r => r.id === 'frontend-direct-db')!;
      const violations = directDbRule.check([frontend, backend], [conn]);

      expect(violations).toHaveLength(0);
    });
  });

  describe('unused-package', () => {
    it('should detect package with status "unused"', () => {
      const pkg = createComponent({ name: 'lodash', type: 'npm', status: 'unused' });

      const rules = getBuiltinRules();
      const unusedRule = rules.find(r => r.id === 'unused-package')!;
      const violations = unusedRule.check([pkg], []);

      expect(violations).toHaveLength(1);
      expect(violations[0].rule_id).toBe('unused-package');
      expect(violations[0].severity).toBe('info');
      expect(violations[0].component).toBe('lodash');
      expect(violations[0].message).toContain('is detected but unused');
      expect(violations[0].suggestion).toContain('npm uninstall');
    });
  });

  describe('vulnerable-dependency', () => {
    it('should detect package with status "vulnerable"', () => {
      const pkg = createComponent({ name: 'old-package', type: 'npm', status: 'vulnerable' });

      const rules = getBuiltinRules();
      const vulnRule = rules.find(r => r.id === 'vulnerable-dependency')!;
      const violations = vulnRule.check([pkg], []);

      expect(violations).toHaveLength(1);
      expect(violations[0].rule_id).toBe('vulnerable-dependency');
      expect(violations[0].severity).toBe('error');
      expect(violations[0].component).toBe('old-package');
      expect(violations[0].message).toContain('security vulnerabilities');
      expect(violations[0].suggestion).toContain('npm audit fix');
    });
  });

  describe('deprecated-dependency', () => {
    it('should detect package with status "deprecated"', () => {
      const pkg = createComponent({ name: 'moment', type: 'npm', status: 'deprecated' });

      const rules = getBuiltinRules();
      const depRule = rules.find(r => r.id === 'deprecated-dependency')!;
      const violations = depRule.check([pkg], []);

      expect(violations).toHaveLength(1);
      expect(violations[0].rule_id).toBe('deprecated-dependency');
      expect(violations[0].severity).toBe('warning');
      expect(violations[0].component).toBe('moment');
      expect(violations[0].message).toContain('is deprecated');
      expect(violations[0].suggestion).toContain('replacement package');
    });
  });

  describe('single-point-of-failure', () => {
    it('should detect backend component with >5 dependents', () => {
      const backend = createComponent({ name: 'CoreAPI', layer: 'backend' });
      const components = [backend];
      const connections = [];

      // Create 6 dependent components
      for (let i = 0; i < 6; i++) {
        const dependent = createComponent({ name: `Service${i}`, layer: 'backend' });
        components.push(dependent);
        connections.push(createConnection(dependent.component_id, backend.component_id));
      }

      const rules = getBuiltinRules();
      const spofRule = rules.find(r => r.id === 'single-point-of-failure')!;
      const violations = spofRule.check(components, connections);

      expect(violations).toHaveLength(1);
      expect(violations[0].rule_id).toBe('single-point-of-failure');
      expect(violations[0].severity).toBe('warning');
      expect(violations[0].component).toBe('CoreAPI');
      expect(violations[0].message).toContain('6 dependents');
      expect(violations[0].suggestion).toContain('redundancy');
    });

    it('should not flag backend with <=5 dependents', () => {
      const backend = createComponent({ name: 'API', layer: 'backend' });
      const components = [backend];
      const connections = [];

      // Create 5 dependent components (threshold)
      for (let i = 0; i < 5; i++) {
        const dependent = createComponent({ name: `Service${i}`, layer: 'backend' });
        components.push(dependent);
        connections.push(createConnection(dependent.component_id, backend.component_id));
      }

      const rules = getBuiltinRules();
      const spofRule = rules.find(r => r.id === 'single-point-of-failure')!;
      const violations = spofRule.check(components, connections);

      expect(violations).toHaveLength(0);
    });
  });

  describe('hotspot-module', () => {
    it('detects internal modules with high fan-in', () => {
      const hotspot = createComponent({ name: 'core/types', type: 'component', file: 'src/core/types.ts' });
      const components = [hotspot];
      const connections = [];

      for (let i = 0; i < 5; i++) {
        const dependent = createComponent({ name: `cdp/dep-${i}`, type: 'component', file: `src/cdp/dep-${i}.ts` });
        components.push(dependent);
        connections.push(createConnection(dependent, hotspot, { connection_type: 'imports' }));
      }

      const rule = getBuiltinRules().find(r => r.id === 'hotspot-module')!;
      const violations = rule.check(components, connections);

      expect(violations).toHaveLength(1);
      expect(violations[0].component).toBe('core/types');
      expect(violations[0].message).toContain('5 dependents');
    });
  });

  describe('high-fan-out', () => {
    it('detects internal modules with high fan-out', () => {
      const driver = createComponent({ name: 'cdp/driver', type: 'component', file: 'src/cdp/driver.ts' });
      const components = [driver];
      const connections = [];

      for (let i = 0; i < 8; i++) {
        const dep = createComponent({ name: `core/dep-${i}`, type: 'component', file: `src/core/dep-${i}.ts` });
        components.push(dep);
        connections.push(createConnection(driver, dep, { connection_type: 'imports' }));
      }

      const rule = getBuiltinRules().find(r => r.id === 'high-fan-out')!;
      const violations = rule.check(components, connections);

      expect(violations).toHaveLength(1);
      expect(violations[0].component).toBe('cdp/driver');
      expect(violations[0].message).toContain('imports 8 modules');
    });
  });

  describe('shallow-module', () => {
    it('fires (advisory) on a thin pass-through module', () => {
      // glue imports 6 modules, used by 1 → shallow.
      const glue = createComponent({ name: 'glue/wire', type: 'component', file: 'src/glue/wire.ts' });
      const app = createComponent({ name: 'app/main', type: 'component', file: 'src/app/main.ts' });
      const components = [glue, app];
      const connections = [createConnection(app, glue, { connection_type: 'imports' })];

      for (let i = 0; i < 6; i++) {
        const dep = createComponent({ name: `core/dep-${i}`, type: 'component', file: `src/core/dep-${i}.ts` });
        components.push(dep);
        connections.push(createConnection(glue, dep, { connection_type: 'imports' }));
      }

      const rule = getBuiltinRules().find(r => r.id === 'shallow-module')!;
      const violations = rule.check(components, connections);

      expect(violations).toHaveLength(1);
      expect(violations[0].component).toBe('glue/wire');
      expect(violations[0].severity).toBe('warning');
      expect(violations[0].message).toContain('shallow module');
      expect(violations[0].message).toContain('imports 6');
    });
  });

  describe('layer-violation', () => {
    it('detects upward import violations', () => {
      const core = createComponent({ name: 'core/types', type: 'component', file: 'src/core/types.ts' });
      const cdp = createComponent({ name: 'cdp/driver', type: 'component', file: 'src/cdp/driver.ts' });

      const rule = getBuiltinRules().find(r => r.id === 'layer-violation')!;
      const violations = rule.check(
        [core, cdp],
        [createConnection(cdp, core, { connection_type: 'imports' }), createConnection(core, cdp, { connection_type: 'imports' })]
      );

      expect(violations).toHaveLength(1);
      expect(violations[0].component).toBe('cdp/driver');
      expect(violations[0].message).toContain('core/types');
    });
  });

  describe('circular-dependency', () => {
    it('detects import cycles', () => {
      const a = createComponent({ name: 'core/a', type: 'component', file: 'src/core/a.ts' });
      const b = createComponent({ name: 'core/b', type: 'component', file: 'src/core/b.ts' });
      const c = createComponent({ name: 'core/c', type: 'component', file: 'src/core/c.ts' });

      const rule = getBuiltinRules().find(r => r.id === 'circular-dependency')!;
      const violations = rule.check(
        [a, b, c],
        [
          createConnection(a, b, { connection_type: 'imports' }),
          createConnection(b, c, { connection_type: 'imports' }),
          createConnection(c, a, { connection_type: 'imports' }),
        ]
      );

      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('core/a');
      expect(violations[0].message).toContain('core/c');
    });
  });

  describe('transitively-dead', () => {
    it('follows dependency edges forward without letting a live dependency rescue dead dependents', () => {
      const mainApp = createComponent({ name: 'MainApp', type: 'component', file: 'src/MainApp.ts' });
      const shared = createComponent({ name: 'Shared', type: 'component', file: 'src/Shared.ts' });
      const deadFeature = createComponent({ name: 'DeadFeature', type: 'component', file: 'src/DeadFeature.ts' });

      const rule = getBuiltinRules().find(r => r.id === 'transitively-dead')!;
      const violations = rule.check(
        [mainApp, shared, deadFeature],
        [
          createConnection(mainApp, shared, { connection_type: 'imports' }),
          createConnection(deadFeature, shared, { connection_type: 'imports' }),
        ]
      );

      expect(violations.map(v => v.component)).toEqual(['DeadFeature']);
    });

    it('keeps disconnected cycles dead and does not treat incidental Main substrings as roots', () => {
      const mainApp = createComponent({ name: 'MainApp', type: 'component', file: 'src/MainApp.ts' });
      const shared = createComponent({ name: 'Shared', type: 'component', file: 'src/Shared.ts' });
      const explicitMain = createComponent({ name: 'cli/Main', type: 'component', file: 'src/cli/Main.ts' });
      const mainDependency = createComponent({ name: 'MainDependency', type: 'component', file: 'src/MainDependency.ts' });
      const domainMainHelper = createComponent({ name: 'DomainMainHelper', type: 'component', file: 'src/DomainMainHelper.ts' });
      const deadCyclePeer = createComponent({ name: 'DeadCyclePeer', type: 'component', file: 'src/DeadCyclePeer.ts' });

      const rule = getBuiltinRules().find(r => r.id === 'transitively-dead')!;
      const violations = rule.check(
        [mainApp, shared, explicitMain, mainDependency, domainMainHelper, deadCyclePeer],
        [
          createConnection(mainApp, shared, { connection_type: 'imports' }),
          createConnection(explicitMain, mainDependency, { connection_type: 'imports' }),
          createConnection(domainMainHelper, deadCyclePeer, { connection_type: 'imports' }),
          createConnection(deadCyclePeer, domainMainHelper, { connection_type: 'imports' }),
        ]
      );

      expect(violations.map(v => v.component).sort()).toEqual([
        'DeadCyclePeer',
        'DomainMainHelper',
      ]);
    });

    it('does not apply runtime reachability rules to content documents', () => {
      const mainApp = createComponent({ name: 'MainApp', type: 'component', file: 'src/MainApp.ts' });
      const documentA = createComponent({ name: 'document-a', type: 'document', layer: 'content', file: 'wiki/a.md' });
      const documentB = createComponent({ name: 'document-b', type: 'document', layer: 'content', file: 'wiki/b.md' });
      const rule = getBuiltinRules().find(r => r.id === 'transitively-dead')!;

      const violations = rule.check(
        [mainApp, documentA, documentB],
        [createConnection(documentA, documentB, { connection_type: 'wikilink' })]
      );

      expect(violations).toHaveLength(0);
    });
  });

  /**
   * The defect: on a CLI/library package the root set found no front door, so
   * every module behind it read as dead — 425 of 451 components on NavGator's
   * own graph. These tests pin both directions. The differential in the first
   * one is the important part: the SAME graph flips from "all dead" to "one
   * dead" purely by whether the package manifest is readable, which is exactly
   * the mechanism that was missing.
   */
  describe('transitively-dead entry-point resolution', () => {
    let root: string;
    let noManifest: string;

    beforeAll(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-rules-cli-'));
      fs.writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify({ name: 'fixture', bin: { fixture: 'dist/cli/index.js' } })
      );
      noManifest = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-rules-bare-'));
    });

    afterAll(() => {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(noManifest, { recursive: true, force: true });
    });

    // cli -> service -> storage is the live chain; abandoned imports storage but
    // nothing imports abandoned. `sdk` reproduces the only root the pre-fix
    // detector ever found on a CLI package: an external node, which is a graph
    // SINK, so admitting it as a root reaches nothing.
    const cliGraph = () => {
      const cli = createComponent({ name: 'cli', type: 'component', file: 'src/cli/index.ts' });
      const service = createComponent({ name: 'service', type: 'component', file: 'src/service.ts' });
      const storage = createComponent({ name: 'storage', type: 'component', file: 'src/storage.ts' });
      const abandoned = createComponent({ name: 'abandoned', type: 'component', file: 'src/abandoned.ts' });
      const sdk = createComponent({ name: 'openai', type: 'service', layer: 'external', file: 'package.json' });
      return {
        components: [cli, service, storage, abandoned, sdk],
        connections: [
          createConnection(cli, service, { connection_type: 'imports' }),
          createConnection(service, storage, { connection_type: 'imports' }),
          createConnection(abandoned, storage, { connection_type: 'imports' }),
          createConnection(service, sdk, { connection_type: 'uses-package' }),
        ],
      };
    };

    it('reaches the whole chain behind a package bin and still flags what nothing imports', () => {
      const { components, connections } = cliGraph();
      const rule = getBuiltinRules(root).find(r => r.id === 'transitively-dead')!;

      expect(rule.check(components, connections).map(v => v.component)).toEqual(['abandoned']);
    });

    it('reports the same graph as almost entirely dead when the manifest is missing', () => {
      // This is the pre-fix behaviour, kept as the falsifier: if the fix were
      // "stop flagging things", this assertion would fail too.
      const { components, connections } = cliGraph();
      const rule = getBuiltinRules(noManifest).find(r => r.id === 'transitively-dead')!;

      expect(rule.check(components, connections).map(v => v.component).sort()).toEqual([
        'abandoned',
        'cli',
        'service',
        'storage',
      ]);
    });

    it('forwards the project root through checkRules, not just the rule closure', () => {
      // The fix is worthless on any surface that knows the project root but
      // does not pass it — `review`, the MCP rules tool, and the agent
      // executive summary all scan a project that need not be the process cwd.
      // This pins the parameter, so wiring one of them back to cwd fails here.
      const { components, connections } = cliGraph();

      const withRoot = checkRules(components, connections, undefined, root)
        .filter(v => v.rule_id === 'transitively-dead')
        .map(v => v.component);
      const withoutRoot = checkRules(components, connections, undefined, noManifest)
        .filter(v => v.rule_id === 'transitively-dead')
        .map(v => v.component);

      expect(withRoot).toEqual(['abandoned']);
      expect(withoutRoot.length).toBeGreaterThan(withRoot.length);
    });

    it('does not report a declared dependency as dead code', () => {
      // `next` is detected out of a package.json, so it is a dependency record,
      // not source anybody can delete. It is also a graph sink, so reachability
      // can never rescue it.
      const cli = createComponent({ name: 'cli', type: 'component', file: 'src/cli/index.ts' });
      const framework = createComponent({
        name: 'next',
        type: 'framework',
        layer: 'frontend',
        file: 'package.json',
      });
      const rule = getBuiltinRules(root).find(r => r.id === 'transitively-dead')!;

      const violations = rule.check(
        [cli, framework],
        [createConnection(framework, cli, { connection_type: 'uses-package' })]
      );
      expect(violations).toHaveLength(0);
    });

    it('does not report vendored third-party source as dead code', () => {
      const cli = createComponent({ name: 'cli', type: 'component', file: 'src/cli/index.ts' });
      const vendored = createComponent({
        name: 'vendored-lib',
        type: 'component',
        file: 'web/runtime/node_modules/left-pad/index.js',
      });
      const authored = createComponent({ name: 'authored', type: 'component', file: 'src/authored.ts' });
      const rule = getBuiltinRules(root).find(r => r.id === 'transitively-dead')!;

      const violations = rule.check(
        [cli, vendored, authored],
        [
          createConnection(vendored, authored, { connection_type: 'imports' }),
          createConnection(authored, cli, { connection_type: 'imports' }),
        ]
      );
      // The vendored copy is skipped; the authored module it drags along is not.
      expect(violations.map(v => v.component)).toEqual(['authored']);
    });
  });

  describe('detectRuleDegeneracy', () => {
    it('flags a rule that fires on most of the codebase', () => {
      // The measured shape of the defect: 425 of 451 components, one rule.
      const report = detectRuleDegeneracy(
        { 'transitively-dead': 425, 'layer-violation': 1, 'circular-dependency': 5 },
        451
      );

      expect(report.degenerate.map(d => d.rule_id)).toEqual(['transitively-dead']);
      expect(report.degenerate[0]!.share_of_components).toBeCloseTo(425 / 451, 6);
      expect(report.degenerate[0]!.share_of_violations).toBeCloseTo(425 / 431, 6);
      expect(report.warnings[0]).toContain('transitively-dead');
      expect(report.warnings[0]).toContain('425 of 451');
    });

    it('stays silent on a rule that discriminates', () => {
      // The post-fix measurement on the same repo.
      const report = detectRuleDegeneracy(
        { 'transitively-dead': 92, 'layer-violation': 1, 'circular-dependency': 5 },
        451
      );
      expect(report.degenerate).toEqual([]);
      expect(report.warnings).toEqual([]);
    });

    it('refuses to call a tiny population degenerate', () => {
      const population = RULE_DEGENERACY_MIN_POPULATION - 1;
      const report = detectRuleDegeneracy({ 'some-rule': population }, population);
      expect(report.degenerate).toEqual([]);
    });

    it('counts distinct components, so one noisy component is not prevalence', () => {
      const violations: RuleViolation[] = [
        { rule_id: 'r', severity: 'warning', component: 'a', message: '' },
        { rule_id: 'r', severity: 'warning', component: 'a', message: '' },
        { rule_id: 'r', severity: 'warning', component: 'b', message: '' },
        { rule_id: 'r', severity: 'warning', message: '' },
      ];
      expect(countComponentsPerRule(violations)).toEqual({ r: 2 });
    });
  });

  describe('checkRules', () => {
    it('should run all rules and return combined violations', () => {
      const orphan = createComponent({ name: 'Orphan', layer: 'frontend' });
      const vulnerable = createComponent({ name: 'VulnPkg', type: 'npm', status: 'vulnerable' });
      const deprecated = createComponent({ name: 'DepPkg', type: 'npm', status: 'deprecated' });

      const violations = checkRules([orphan, vulnerable, deprecated], []);

      expect(violations.length).toBeGreaterThan(0);
      expect(violations.some(v => v.rule_id === 'orphan-component')).toBe(true);
      expect(violations.some(v => v.rule_id === 'vulnerable-dependency')).toBe(true);
      expect(violations.some(v => v.rule_id === 'deprecated-dependency')).toBe(true);
    });

    it('should accept custom rules array', () => {
      const customRule: ArchitectureRule = {
        id: 'custom-test',
        name: 'Custom Test',
        description: 'Test rule',
        severity: 'info',
        check: () => [
          {
            rule_id: 'custom-test',
            severity: 'info',
            message: 'Custom violation',
          },
        ],
      };

      const violations = checkRules([], [], [customRule]);

      expect(violations).toHaveLength(1);
      expect(violations[0].rule_id).toBe('custom-test');
    });
  });

  describe('formatRulesOutput', () => {
    it('should return success message when no violations', () => {
      const output = formatRulesOutput([]);
      expect(output).toContain('No architecture rule violations found');
    });

    it('should format violations by severity', () => {
      const violations: RuleViolation[] = [
        {
          rule_id: 'test-error',
          severity: 'error',
          component: 'TestComp',
          message: 'Error message',
          suggestion: 'Fix it',
        },
        {
          rule_id: 'test-warning',
          severity: 'warning',
          message: 'Warning message',
        },
        {
          rule_id: 'test-info',
          severity: 'info',
          message: 'Info message',
        },
      ];

      const output = formatRulesOutput(violations);

      expect(output).toContain('3 violation(s)');
      expect(output).toContain('ERROR');
      expect(output).toContain('WARN');
      expect(output).toContain('INFO');
      expect(output).toContain('Error message');
      expect(output).toContain('Warning message');
      expect(output).toContain('Info message');
      expect(output).toContain('Fix it');
    });

    it('should filter by severity', () => {
      const violations: RuleViolation[] = [
        {
          rule_id: 'test-error',
          severity: 'error',
          message: 'Error message',
        },
        {
          rule_id: 'test-warning',
          severity: 'warning',
          message: 'Warning message',
        },
      ];

      const output = formatRulesOutput(violations, 'error');

      expect(output).toContain('ERROR');
      expect(output).toContain('Error message');
      expect(output).not.toContain('WARN');
      expect(output).not.toContain('Warning message');
    });
  });

  describe('custom JSON rules', () => {
    it('should enforce forbidden connection pattern', () => {
      const customRule: ArchitectureRule = {
        id: 'no-frontend-to-db',
        name: 'No Frontend to DB',
        description: 'Frontend must not connect to database',
        severity: 'error',
        check: (components, connections) => {
          const violations: RuleViolation[] = [];
          const frontendIds = new Set(
            components.filter(c => c.role.layer === 'frontend').map(c => c.component_id)
          );
          const dbIds = new Set(
            components.filter(c => c.role.layer === 'database').map(c => c.component_id)
          );

          for (const conn of connections) {
            const from = components.find(c => c.component_id === conn.from.component_id);
            const to = components.find(c => c.component_id === conn.to.component_id);
            if (!from || !to) continue;

            if (frontendIds.has(conn.from.component_id) && dbIds.has(conn.to.component_id)) {
              violations.push({
                rule_id: 'no-frontend-to-db',
                severity: 'error',
                component: from.name,
                message: `${from.name} → ${to.name} violates rule: No Frontend to DB`,
                suggestion: 'Frontend must not connect to database',
              });
            }
          }

          return violations;
        },
      };

      const frontend = createComponent({ name: 'React', layer: 'frontend' });
      const db = createComponent({ name: 'PostgreSQL', layer: 'database' });
      const conn = createConnection(frontend.component_id, db.component_id);

      const violations = checkRules([frontend, db], [conn], [customRule]);

      expect(violations).toHaveLength(1);
      expect(violations[0].rule_id).toBe('no-frontend-to-db');
      expect(violations[0].severity).toBe('error');
      expect(violations[0].message).toContain('React → PostgreSQL');
    });
  });
});
