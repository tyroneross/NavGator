import { describe, it, expect } from 'vitest';
import { createMockComponent, createMockConnection } from '../helpers.js';
import { buildCrossRepoMap } from '../../portfolio/cross-repo.js';
import type { CrossRepoRepoInput } from '../../portfolio/types.js';

describe('buildCrossRepoMap', () => {
  it('finds a shared dependency present in 2+ repos and flags version skew', () => {
    const repoA: CrossRepoRepoInput = {
      repo: '/repos/repo-a',
      components: [
        createMockComponent({
          name: 'lodash',
          type: 'npm',
          version: '4.17.21',
          role: { purpose: 'utility', layer: 'external', critical: false },
        }),
      ],
      connections: [],
    };
    const repoB: CrossRepoRepoInput = {
      repo: '/repos/repo-b',
      components: [
        createMockComponent({
          name: 'lodash',
          type: 'npm',
          version: '4.17.15',
          role: { purpose: 'utility', layer: 'external', critical: false },
        }),
      ],
      connections: [],
    };

    const map = buildCrossRepoMap([repoA, repoB]);

    expect(map.sharedDependencies.length).toBeGreaterThan(0);
    const lodash = map.sharedDependencies.find((d) => d.name === 'lodash');
    expect(lodash).toBeDefined();
    expect(lodash?.repos.map((r) => r.repo).sort()).toEqual(['/repos/repo-a', '/repos/repo-b']);
    expect(lodash?.versionSkew).toBe(true);
  });

  it('does not report a dependency present in only one repo', () => {
    const repoA: CrossRepoRepoInput = {
      repo: '/repos/repo-a',
      components: [
        createMockComponent({
          name: 'unique-pkg',
          type: 'npm',
          version: '1.0.0',
          role: { purpose: 'utility', layer: 'external', critical: false },
        }),
      ],
      connections: [],
    };
    const repoB: CrossRepoRepoInput = { repo: '/repos/repo-b', components: [], connections: [] };

    const map = buildCrossRepoMap([repoA, repoB]);
    expect(map.sharedDependencies.some((d) => d.name === 'unique-pkg')).toBe(false);
  });

  it('does not flag skew when repos share the same version', () => {
    const same = { name: 'react', type: 'npm' as const, version: '18.2.0' };
    const repoA: CrossRepoRepoInput = {
      repo: '/repos/repo-a',
      components: [createMockComponent({ ...same, role: { purpose: 'ui', layer: 'external', critical: false } })],
      connections: [],
    };
    const repoB: CrossRepoRepoInput = {
      repo: '/repos/repo-b',
      components: [createMockComponent({ ...same, role: { purpose: 'ui', layer: 'external', critical: false } })],
      connections: [],
    };

    const map = buildCrossRepoMap([repoA, repoB]);
    const react = map.sharedDependencies.find((d) => d.name === 'react');
    expect(react?.versionSkew).toBe(false);
  });

  it('produces a heuristic cross-repo service-call edge with confidence and basis, via host+port match', () => {
    // repo A: an OrderService that calls something it believes lives at payments.internal:4000
    const target = createMockComponent({
      component_id: 'COMP_service_payments_target',
      name: 'payments-endpoint',
      type: 'service',
      role: { purpose: 'external call target', layer: 'external', critical: false },
      runtime: { endpoint: { host: 'payments.internal', port: 4000 } },
    });
    const caller = createMockComponent({
      component_id: 'COMP_service_order_service',
      name: 'OrderService',
      type: 'service',
      role: { purpose: 'orders', layer: 'backend', critical: true },
    });
    const conn = createMockConnection(caller.component_id, target.component_id, {
      connection_type: 'service-call',
    });
    const repoA: CrossRepoRepoInput = {
      repo: '/repos/order-service',
      components: [caller, target],
      connections: [conn],
    };

    // repo B: the actual payments service, declaring its own runtime identity
    const paymentsService = createMockComponent({
      component_id: 'COMP_service_payments_real',
      name: 'PaymentsService',
      type: 'service',
      role: { purpose: 'payments', layer: 'backend', critical: true },
      runtime: { service_name: 'payments-service', endpoint: { host: 'payments.internal', port: 4000 } },
    });
    const repoB: CrossRepoRepoInput = {
      repo: '/repos/payments-service',
      components: [paymentsService],
      connections: [],
    };

    const map = buildCrossRepoMap([repoA, repoB]);

    expect(map.serviceCalls.length).toBeGreaterThan(0);
    const edge = map.serviceCalls[0];
    expect(edge.heuristic).toBe(true);
    expect(edge.basis).toBe('host-match');
    expect(typeof edge.confidence).toBe('number');
    expect(edge.fromRepo).toBe('/repos/order-service');
    expect(edge.toRepo).toBe('/repos/payments-service');
  });

  it('computes portfolio status: counts, stale (>24h), failed, and busy repos', () => {
    const now = Date.now();
    const staleRepo: CrossRepoRepoInput = {
      repo: '/repos/stale',
      components: [createMockComponent({ name: 'x' })],
      connections: [],
      lastScan: now - 25 * 60 * 60 * 1000,
    };
    const freshRepo: CrossRepoRepoInput = {
      repo: '/repos/fresh',
      components: [],
      connections: [],
      lastScan: now - 1000,
    };
    const failedRepo: CrossRepoRepoInput = {
      repo: '/repos/failed',
      components: [],
      connections: [],
      scanStatus: 'failed',
    };
    const busyRepo: CrossRepoRepoInput = {
      repo: '/repos/busy',
      components: [],
      connections: [],
      scanStatus: 'busy',
    };

    const map = buildCrossRepoMap([staleRepo, freshRepo, failedRepo, busyRepo]);

    expect(map.status.repoCount).toBe(4);
    expect(map.status.totalComponents).toBe(1);
    expect(map.status.staleRepos).toEqual(['/repos/stale']);
    expect(map.status.failedRepos).toEqual(['/repos/failed']);
    expect(map.status.busyRepos).toEqual(['/repos/busy']);
  });
});
