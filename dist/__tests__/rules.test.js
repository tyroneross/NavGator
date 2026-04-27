import { describe, it, expect } from 'vitest';
import { getBuiltinRules, checkRules, formatRulesOutput, } from '../rules.js';
import { createComponent, createConnection } from './helpers.js';
describe('Architecture Rules', () => {
    describe('orphan-component', () => {
        it('should detect component with no connections', () => {
            const comp1 = createComponent({ name: 'OrphanComp', layer: 'frontend' });
            const comp2 = createComponent({ name: 'ConnectedComp', layer: 'backend' });
            const conn = createConnection(comp2.component_id, comp2.component_id);
            const rules = getBuiltinRules();
            const orphanRule = rules.find(r => r.id === 'orphan-component');
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
            const orphanRule = rules.find(r => r.id === 'orphan-component');
            const violations = orphanRule.check([comp1, comp2], [conn]);
            expect(violations).toHaveLength(0);
        });
    });
    describe('database-no-backend', () => {
        it('should detect database without backend connection', () => {
            const db = createComponent({ name: 'PostgreSQL', layer: 'database' });
            const frontend = createComponent({ name: 'React', layer: 'frontend' });
            const rules = getBuiltinRules();
            const dbRule = rules.find(r => r.id === 'database-no-backend');
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
            const dbRule = rules.find(r => r.id === 'database-no-backend');
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
            const directDbRule = rules.find(r => r.id === 'frontend-direct-db');
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
            const directDbRule = rules.find(r => r.id === 'frontend-direct-db');
            const violations = directDbRule.check([frontend, backend], [conn]);
            expect(violations).toHaveLength(0);
        });
    });
    describe('unused-package', () => {
        it('should detect package with status "unused"', () => {
            const pkg = createComponent({ name: 'lodash', type: 'npm', status: 'unused' });
            const rules = getBuiltinRules();
            const unusedRule = rules.find(r => r.id === 'unused-package');
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
            const vulnRule = rules.find(r => r.id === 'vulnerable-dependency');
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
            const depRule = rules.find(r => r.id === 'deprecated-dependency');
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
            const spofRule = rules.find(r => r.id === 'single-point-of-failure');
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
            const spofRule = rules.find(r => r.id === 'single-point-of-failure');
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
            const rule = getBuiltinRules().find(r => r.id === 'hotspot-module');
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
            const rule = getBuiltinRules().find(r => r.id === 'high-fan-out');
            const violations = rule.check(components, connections);
            expect(violations).toHaveLength(1);
            expect(violations[0].component).toBe('cdp/driver');
            expect(violations[0].message).toContain('imports 8 modules');
        });
    });
    describe('layer-violation', () => {
        it('detects upward import violations', () => {
            const core = createComponent({ name: 'core/types', type: 'component', file: 'src/core/types.ts' });
            const cdp = createComponent({ name: 'cdp/driver', type: 'component', file: 'src/cdp/driver.ts' });
            const rule = getBuiltinRules().find(r => r.id === 'layer-violation');
            const violations = rule.check([core, cdp], [createConnection(cdp, core, { connection_type: 'imports' }), createConnection(core, cdp, { connection_type: 'imports' })]);
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
            const rule = getBuiltinRules().find(r => r.id === 'circular-dependency');
            const violations = rule.check([a, b, c], [
                createConnection(a, b, { connection_type: 'imports' }),
                createConnection(b, c, { connection_type: 'imports' }),
                createConnection(c, a, { connection_type: 'imports' }),
            ]);
            expect(violations).toHaveLength(1);
            expect(violations[0].message).toContain('core/a');
            expect(violations[0].message).toContain('core/c');
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
            const customRule = {
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
            const violations = [
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
            const violations = [
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
            const customRule = {
                id: 'no-frontend-to-db',
                name: 'No Frontend to DB',
                description: 'Frontend must not connect to database',
                severity: 'error',
                check: (components, connections) => {
                    const violations = [];
                    const frontendIds = new Set(components.filter(c => c.role.layer === 'frontend').map(c => c.component_id));
                    const dbIds = new Set(components.filter(c => c.role.layer === 'database').map(c => c.component_id));
                    for (const conn of connections) {
                        const from = components.find(c => c.component_id === conn.from.component_id);
                        const to = components.find(c => c.component_id === conn.to.component_id);
                        if (!from || !to)
                            continue;
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
//# sourceMappingURL=rules.test.js.map