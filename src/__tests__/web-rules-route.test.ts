import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EMPTY_RULES, hasProjectArchitecture, parseRulesCliOutput } from '../../web/lib/server/rules-output.js';
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('web rules route CLI contract', () => {
  it('keeps the unbounded violation list while preserving authoritative summary counts', () => {
    const violations = Array.from({ length: 75 }, (_, index) => ({
      rule_id: 'orphan-component',
      severity: 'warning' as const,
      component: `component-${index}`,
      message: `component-${index} is orphaned`,
    }));
    const parsed = parseRulesCliOutput(JSON.stringify({
      violations,
      summary: { total: 75, errors: 0, warnings: 75, info: 0 },
    }));

    expect(parsed.violations).toHaveLength(75);
    expect(parsed.summary).toEqual({ total: 75, errors: 0, warnings: 75, info: 0 });
  });

  it('rejects a truncated or incompatible payload instead of rendering false zeroes', () => {
    expect(() => parseRulesCliOutput(JSON.stringify({ summary: { total: 75 } }))).toThrow(
      'incompatible response',
    );
  });

  it('treats an unscanned child as empty even when its parent is scanned', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-rules-parent-'));
    tempRoots.push(parent);
    fs.mkdirSync(path.join(parent, '.navgator', 'architecture'), { recursive: true });
    fs.writeFileSync(path.join(parent, '.navgator', 'architecture', 'index.json'), '{}');
    const child = path.join(parent, 'child');
    fs.mkdirSync(child);

    expect(hasProjectArchitecture(parent)).toBe(true);
    expect(hasProjectArchitecture(child)).toBe(false);
    expect(EMPTY_RULES.summary.total).toBe(0);
  });
});
