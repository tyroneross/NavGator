/**
 * Tests for component identity: base-name normalization and alias merging
 */

import { describe, it, expect } from 'vitest';
import { componentBaseName, identityKey, mergeComponentAliases } from '../component-identity.js';
import { createMockComponent } from './helpers.js';

describe('componentBaseName', () => {
  it('collapses "Railway", "Railway Config", and "Railway (infra)" to the same base name', () => {
    expect(componentBaseName('Railway')).toBe('railway');
    expect(componentBaseName('Railway Config')).toBe('railway');
    expect(componentBaseName('Railway (infra)')).toBe('railway');
  });

  it('collapses "bullmq@5.61.0" and "BullMQ" to the same base name', () => {
    expect(componentBaseName('bullmq@5.61.0')).toBe('bullmq');
    expect(componentBaseName('BullMQ')).toBe('bullmq');
  });
});

describe('identityKey', () => {
  it('never merges components of different types even with the same base name', () => {
    const infra = { name: 'Railway (infra)', type: 'infra' as const };
    const deploy = { name: 'Railway Config', type: 'config' as const };
    expect(identityKey(infra)).not.toBe(identityKey(deploy));
  });

  it('produces the same key for aliases of the same type', () => {
    const a = { name: 'Railway', type: 'infra' as const };
    const b = { name: 'Railway Config', type: 'infra' as const };
    const c = { name: 'Railway (infra)', type: 'infra' as const };
    expect(identityKey(a)).toBe(identityKey(b));
    expect(identityKey(b)).toBe(identityKey(c));
  });
});

describe('mergeComponentAliases', () => {
  it('collapses "Railway" / "Railway Config" / "Railway (infra)" into one component', () => {
    const components = [
      createMockComponent({ name: 'Railway', type: 'infra' }),
      createMockComponent({ name: 'Railway Config', type: 'infra' }),
      createMockComponent({ name: 'Railway (infra)', type: 'infra' }),
    ];
    const merged = mergeComponentAliases(components);
    expect(merged.length).toBe(1);
  });

  it('collapses "bullmq@5.61.0" and "BullMQ" into one component', () => {
    const components = [
      createMockComponent({ name: 'bullmq@5.61.0', type: 'npm' }),
      createMockComponent({ name: 'BullMQ', type: 'npm' }),
    ];
    const merged = mergeComponentAliases(components);
    expect(merged.length).toBe(1);
  });

  it('never merges components of different types', () => {
    const components = [
      createMockComponent({ name: 'Railway', type: 'infra' }),
      createMockComponent({ name: 'Railway Config', type: 'config' }),
    ];
    const merged = mergeComponentAliases(components);
    expect(merged.length).toBe(2);
  });

  it('keeps the component with more connections when merging', () => {
    const lowConn = createMockComponent({
      component_id: 'COMP_infra_railway_low',
      name: 'Railway Config',
      type: 'infra',
      connects_to: [],
      connected_from: [],
    });
    const highConn = createMockComponent({
      component_id: 'COMP_infra_railway_high',
      name: 'Railway',
      type: 'infra',
      connects_to: [{ connection_id: 'CONN_1', target_component_id: 'x', connection_type: 'service-call' }],
      connected_from: [{ connection_id: 'CONN_2', target_component_id: 'y', connection_type: 'service-call' }],
    });

    const merged = mergeComponentAliases([lowConn, highConn]);
    expect(merged.length).toBe(1);
    expect(merged[0].component_id).toBe('COMP_infra_railway_high');
  });
});
