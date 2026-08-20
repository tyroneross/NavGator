import { describe, expect, it } from 'vitest';
import { parseRulesCliOutput } from '../../web/lib/server/rules-output.js';

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
});
