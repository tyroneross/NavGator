import { describe, it, expect } from 'vitest';
import * as path from 'path';
import {
  navgatorBase,
  dirtyEventsPath,
  dirtyLedgerPath,
  dirtyMutationLockPath,
  scanLockPath,
  stampPath,
} from '../../freshness/paths.js';
import { resetConfig } from '../../config.js';

describe('freshness paths', () => {
  const root = '/tmp/example-project';

  it('navgatorBase is <root>/.navgator in local mode', () => {
    expect(navgatorBase(root)).toBe(path.join(root, '.navgator'));
  });

  it('dirty ledger sits at the navgator base', () => {
    expect(dirtyLedgerPath(root)).toBe(path.join(root, '.navgator', 'dirty.json'));
    expect(dirtyEventsPath(root)).toBe(path.join(root, '.navgator', 'dirty.d'));
    expect(dirtyMutationLockPath(root)).toBe(path.join(root, '.navgator', 'dirty.lock'));
  });

  it('scan lock sits at the navgator base', () => {
    expect(scanLockPath(root)).toBe(path.join(root, '.navgator', 'scan.lock'));
  });

  it('stamp sits inside architecture next to the graph', () => {
    expect(stampPath(root)).toBe(path.join(root, '.navgator', 'architecture', 'freshness.json'));
  });

  it('keeps a shared .navgator storage root as the lease base', () => {
    const priorMode = process.env['NAVGATOR_MODE'];
    const priorPath = process.env['NAVGATOR_PATH'];
    process.env['NAVGATOR_MODE'] = 'shared';
    process.env['NAVGATOR_PATH'] = path.join(root, '.navgator');
    resetConfig();
    try {
      expect(navgatorBase(root)).toBe(path.join(root, '.navgator'));
      expect(scanLockPath(root)).toBe(path.join(root, '.navgator', 'scan.lock'));
      expect(stampPath(root)).toBe(path.join(root, '.navgator', 'freshness.json'));
    } finally {
      if (priorMode === undefined) delete process.env['NAVGATOR_MODE'];
      else process.env['NAVGATOR_MODE'] = priorMode;
      if (priorPath === undefined) delete process.env['NAVGATOR_PATH'];
      else process.env['NAVGATOR_PATH'] = priorPath;
      resetConfig();
    }
  });
});
