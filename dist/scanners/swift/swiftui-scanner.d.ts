/**
 * SwiftUI View Scanner
 * Parses SwiftUI view bodies, modifier chains, and navigation structure.
 * Detects:
 * - View composition (which views are used inside other views)
 * - Modifier chains (especially accessibility modifiers)
 * - Navigation flow (NavigationLink, .sheet, .fullScreenCover, .popover, .navigationDestination)
 * - Environment dependencies (@Environment, @EnvironmentObject)
 */
import { ArchitectureComponent, ArchitectureConnection } from '../../types.js';
interface SwiftFileInfo {
    relativePath: string;
    content: string;
    lines: string[];
}
export interface SwiftUIViewInfo {
    name: string;
    file: string;
    line: number;
    composedViews: string[];
    modifiers: ViewModifier[];
    hasNavigationStack: boolean;
    environmentDeps: string[];
}
export interface ViewModifier {
    name: string;
    args: string;
    line: number;
}
export interface NavigationLink {
    sourceView: string;
    destinationView: string;
    type: 'link' | 'destination' | 'sheet' | 'fullScreenCover' | 'popover';
    file: string;
    line: number;
}
export interface SwiftUIResult {
    views: SwiftUIViewInfo[];
    navigationLinks: NavigationLink[];
    components: ArchitectureComponent[];
    connections: ArchitectureConnection[];
}
export declare function scanSwiftUIViews(files: SwiftFileInfo[]): SwiftUIResult;
export {};
//# sourceMappingURL=swiftui-scanner.d.ts.map