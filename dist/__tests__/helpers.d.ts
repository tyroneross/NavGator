/**
 * Shared test fixtures for NavGator tests
 */
import { ArchitectureComponent, ArchitectureConnection, ConnectionGraph, ArchitectureLayer, ComponentType, ComponentStatus } from '../types.js';
/**
 * Create a mock ArchitectureComponent with sensible defaults
 */
export declare function createMockComponent(overrides?: Partial<ArchitectureComponent> & {
    name?: string;
}): ArchitectureComponent;
/**
 * Create a mock ArchitectureConnection
 */
export declare function createMockConnection(fromComponentId: string, toComponentId: string, overrides?: Partial<ArchitectureConnection>): ArchitectureConnection;
/**
 * Shorthand: create a component with flexible args
 * - createComponent('name', { layer: 'frontend' })
 * - createComponent({ name: 'X', layer: 'frontend', type: 'service', status: 'active', file: 'src/x.ts' })
 */
export declare function createComponent(nameOrOpts: string | {
    name: string;
    layer?: ArchitectureLayer;
    type?: ComponentType;
    status?: ComponentStatus;
    file?: string;
}, roleOverrides?: {
    layer?: ArchitectureLayer;
}): ArchitectureComponent;
/**
 * Shorthand: create a connection accepting component objects or IDs
 */
export declare function createConnection(from: ArchitectureComponent | string, to: ArchitectureComponent | string, overrides?: Partial<ArchitectureConnection>): ArchitectureConnection;
/**
 * Create a mock ConnectionGraph from components and connections
 */
export declare function createMockGraph(components: ArchitectureComponent[], connections: ArchitectureConnection[]): ConnectionGraph;
//# sourceMappingURL=helpers.d.ts.map