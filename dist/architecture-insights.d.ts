import type { ArchitectureComponent, ArchitectureConnection } from './types.js';
export interface RankedComponent {
    component: ArchitectureComponent;
    count: number;
}
export interface LayerViolation {
    from: ArchitectureComponent;
    to: ArchitectureComponent;
    connection: ArchitectureConnection;
    fromTier: number;
    toTier: number;
}
export declare function getTopHotspots(components: ArchitectureComponent[], connections: ArchitectureConnection[], limit?: number): RankedComponent[];
export declare function getTopFanOut(components: ArchitectureComponent[], connections: ArchitectureConnection[], limit?: number): RankedComponent[];
export interface ModuleDepthSignal {
    component: ArchitectureComponent;
    fanIn: number;
    fanOut: number;
    shallownessScore: number;
}
export declare function getModuleDepthSignals(components: ArchitectureComponent[], connections: ArchitectureConnection[]): ModuleDepthSignal[];
export declare function detectShallowModules(components: ArchitectureComponent[], connections: ArchitectureConnection[], opts?: {
    minFanOut?: number;
    minShallowness?: number;
    limit?: number;
}): ModuleDepthSignal[];
export declare function detectImportCycles(components: ArchitectureComponent[], connections: ArchitectureConnection[], limit?: number): string[][];
export declare function detectLayerViolations(components: ArchitectureComponent[], connections: ArchitectureConnection[]): LayerViolation[];
//# sourceMappingURL=architecture-insights.d.ts.map