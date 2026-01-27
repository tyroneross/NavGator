/**
 * AST-based Connection Scanner
 * Uses ts-morph for accurate TypeScript/JavaScript analysis
 *
 * This scanner provides higher accuracy than regex by:
 * - Tracking import statements and their usage
 * - Following method chains (import { customers } from 'stripe'; customers.create())
 * - Detecting API calls, database operations, and service integrations
 *
 * NOTE: ts-morph is an optional dependency. Install it with:
 *   npm install ts-morph
 */

import * as path from 'path';
import { glob } from 'glob';
import {
  ArchitectureConnection,
  ArchitectureComponent,
  generateConnectionId,
  generateComponentId,
  ScanResult,
  ScanWarning,
} from '../../types.js';

// =============================================================================
// SERVICE SIGNATURES (for AST detection)
// =============================================================================

interface ServiceSignature {
  serviceName: string;
  importPatterns: string[];
  callPatterns: string[];
  componentType: 'service' | 'database' | 'queue';
  layer: 'external' | 'database' | 'queue';
  purpose: string;
}

const SERVICE_SIGNATURES: ServiceSignature[] = [
  // AI Services
  {
    serviceName: 'Claude (Anthropic)',
    importPatterns: ['@anthropic-ai/sdk', 'anthropic'],
    callPatterns: ['messages.create', 'completions.create'],
    componentType: 'service',
    layer: 'external',
    purpose: 'Claude AI API',
  },
  {
    serviceName: 'OpenAI',
    importPatterns: ['openai'],
    callPatterns: ['chat.completions.create', 'completions.create'],
    componentType: 'service',
    layer: 'external',
    purpose: 'OpenAI API',
  },
  // Payment Services
  {
    serviceName: 'Stripe',
    importPatterns: ['stripe'],
    callPatterns: ['customers', 'paymentIntents', 'subscriptions', 'checkout'],
    componentType: 'service',
    layer: 'external',
    purpose: 'Stripe payments',
  },
  // Database Services
  {
    serviceName: 'Supabase',
    importPatterns: ['@supabase/supabase-js'],
    callPatterns: ['from', 'auth', 'storage'],
    componentType: 'database',
    layer: 'database',
    purpose: 'Supabase backend',
  },
  {
    serviceName: 'Prisma',
    importPatterns: ['@prisma/client'],
    callPatterns: ['findMany', 'findUnique', 'create', 'update', 'delete'],
    componentType: 'database',
    layer: 'database',
    purpose: 'Prisma ORM',
  },
  // Queue Services
  {
    serviceName: 'BullMQ',
    importPatterns: ['bullmq'],
    callPatterns: ['Queue', 'Worker', 'add'],
    componentType: 'queue',
    layer: 'queue',
    purpose: 'BullMQ job queue',
  },
];

// =============================================================================
// TS-MORPH AVAILABILITY
// =============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tsMorphModule: any = null;

/**
 * Check if ts-morph is available
 */
export async function isTsMorphAvailable(): Promise<boolean> {
  if (tsMorphModule) return true;
  try {
    // @ts-expect-error - ts-morph is optional
    tsMorphModule = await import('ts-morph');
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// AST SCANNER
// =============================================================================

/**
 * Scan TypeScript/JavaScript files using AST analysis
 */
export async function scanWithAST(projectRoot: string): Promise<ScanResult> {
  const components: ArchitectureComponent[] = [];
  const connections: ArchitectureConnection[] = [];
  const warnings: ScanWarning[] = [];
  const timestamp = Date.now();

  // Try to load ts-morph
  if (!tsMorphModule) {
    try {
      // @ts-expect-error - ts-morph is optional
      tsMorphModule = await import('ts-morph');
    } catch {
      return {
        components,
        connections,
        warnings: [{
          type: 'parse_error',
          message: 'ts-morph not installed. Run: npm install ts-morph',
        }],
      };
    }
  }

  const { Project, Node } = tsMorphModule;

  // Find all TypeScript/JavaScript files
  const sourceFiles = await glob('**/*.{ts,tsx,js,jsx}', {
    cwd: projectRoot,
    ignore: ['node_modules/**', 'dist/**', 'build/**', '.next/**', '*.d.ts'],
    absolute: true,
  });

  if (sourceFiles.length === 0) {
    return { components, connections, warnings };
  }

  // Create ts-morph project
  const project = new Project({
    compilerOptions: {
      allowJs: true,
      skipLibCheck: true,
      noEmit: true,
    },
    skipAddingFilesFromTsConfig: true,
  });

  // Add source files
  for (const file of sourceFiles) {
    try {
      project.addSourceFileAtPath(file);
    } catch {
      warnings.push({
        type: 'parse_error',
        message: `Could not parse: ${path.relative(projectRoot, file)}`,
        file: path.relative(projectRoot, file),
      });
    }
  }

  // Track found services
  const foundServices = new Map<string, ArchitectureComponent>();

  // Helper: Extract imports from source file
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function extractImports(sourceFile: any) {
    const imports: Array<{
      moduleName: string;
      importedNames: string[];
      defaultImport?: string;
      namespaceImport?: string;
    }> = [];

    for (const importDecl of sourceFile.getImportDeclarations()) {
      const moduleName = importDecl.getModuleSpecifierValue();
      const importedNames: string[] = [];
      let defaultImport: string | undefined;
      let namespaceImport: string | undefined;

      const defaultImportNode = importDecl.getDefaultImport();
      if (defaultImportNode) {
        defaultImport = defaultImportNode.getText();
      }

      const namespaceImportNode = importDecl.getNamespaceImport();
      if (namespaceImportNode) {
        namespaceImport = namespaceImportNode.getText();
      }

      for (const namedImport of importDecl.getNamedImports()) {
        importedNames.push(namedImport.getName());
      }

      imports.push({ moduleName, importedNames, defaultImport, namespaceImport });
    }

    return imports;
  }

  // Helper: Find containing function name
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function findContainingFunction(node: any): string | undefined {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let current: any = node;

    while (current) {
      if (Node.isVariableDeclaration(current)) {
        return current.getName();
      }
      if (Node.isFunctionDeclaration(current)) {
        return current.getName();
      }
      if (Node.isMethodDeclaration(current)) {
        return current.getName();
      }
      current = current.getParent();
    }

    return undefined;
  }

  // Analyze each file
  for (const sourceFile of project.getSourceFiles()) {
    const filePath = path.relative(projectRoot, sourceFile.getFilePath());
    if (filePath.endsWith('.d.ts')) continue;

    const imports = extractImports(sourceFile);

    // Check for service usage
    for (const signature of SERVICE_SIGNATURES) {
      const serviceImport = imports.find(imp =>
        signature.importPatterns.some(pattern =>
          imp.moduleName === pattern || imp.moduleName.startsWith(pattern + '/')
        )
      );

      if (serviceImport) {
        // Create service component if not exists
        if (!foundServices.has(signature.serviceName)) {
          const component: ArchitectureComponent = {
            component_id: generateComponentId(signature.componentType, signature.serviceName),
            name: signature.serviceName,
            type: signature.componentType,
            role: {
              purpose: signature.purpose,
              layer: signature.layer,
              critical: true,
            },
            source: {
              detection_method: 'auto',
              config_files: [],
              confidence: 1.0,
            },
            connects_to: [],
            connected_from: [],
            status: 'active',
            tags: [signature.componentType, signature.layer, 'ast-detected'],
            timestamp,
            last_updated: timestamp,
          };
          foundServices.set(signature.serviceName, component);
          components.push(component);
        }

        // Find call sites
        const identifiersToTrack = [
          ...serviceImport.importedNames,
          serviceImport.defaultImport,
          serviceImport.namespaceImport,
        ].filter(Boolean) as string[];

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sourceFile.forEachDescendant((node: any) => {
          if (Node.isCallExpression(node)) {
            const expression = node.getExpression();
            const expressionText = expression.getText();

            const involvesImport = identifiersToTrack.some(id =>
              expressionText.startsWith(id) || expressionText.includes(`.${id}`)
            );

            if (involvesImport) {
              const serviceComponent = foundServices.get(signature.serviceName)!;
              const line = node.getStartLineNumber();
              const containingFunction = findContainingFunction(node);

              const connection: ArchitectureConnection = {
                connection_id: generateConnectionId('service-call'),
                from: {
                  component_id: `FILE:${filePath}`,
                  location: { file: filePath, line, function: containingFunction },
                },
                to: { component_id: serviceComponent.component_id },
                connection_type: 'service-call',
                code_reference: {
                  file: filePath,
                  symbol: containingFunction || expressionText.slice(0, 40),
                  symbol_type: containingFunction ? 'function' : 'method',
                  line_start: line,
                  code_snippet: node.getText().slice(0, 100),
                },
                description: `Calls ${signature.serviceName}`,
                detected_from: 'AST analysis',
                confidence: 0.95,
                timestamp,
                last_verified: timestamp,
              };
              connections.push(connection);
            }
          }
        });
      }
    }

    // Find API calls (fetch, axios)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sourceFile.forEachDescendant((node: any) => {
      if (Node.isCallExpression(node)) {
        const expression = node.getExpression();
        const expressionText = expression.getText();

        // Check for fetch() calls
        if (expressionText === 'fetch') {
          const args = node.getArguments();
          let endpoint: string | undefined;

          if (args.length > 0) {
            const firstArg = args[0];
            if (Node.isStringLiteral(firstArg)) {
              endpoint = firstArg.getLiteralValue();
            }
          }

          const line = node.getStartLineNumber();
          const containingFunction = findContainingFunction(node);

          connections.push({
            connection_id: generateConnectionId('frontend-calls-api'),
            from: {
              component_id: `FILE:${filePath}`,
              location: { file: filePath, line, function: containingFunction },
            },
            to: { component_id: `API:${endpoint || 'dynamic'}` },
            connection_type: 'frontend-calls-api',
            code_reference: {
              file: filePath,
              symbol: containingFunction || 'anonymous',
              symbol_type: 'function',
              line_start: line,
              code_snippet: node.getText().slice(0, 100),
            },
            description: `API call: GET ${endpoint || '(dynamic)'}`,
            detected_from: 'AST analysis',
            confidence: endpoint ? 0.9 : 0.7,
            timestamp,
            last_verified: timestamp,
          });
        }
      }
    });
  }

  return { components, connections, warnings };
}

/**
 * Scan for database operations (Prisma patterns)
 */
export async function scanDatabaseOperations(projectRoot: string): Promise<ScanResult> {
  const components: ArchitectureComponent[] = [];
  const connections: ArchitectureConnection[] = [];
  const warnings: ScanWarning[] = [];
  const timestamp = Date.now();

  // Try to load ts-morph
  if (!tsMorphModule) {
    try {
      // @ts-expect-error - ts-morph is optional
      tsMorphModule = await import('ts-morph');
    } catch {
      return { components, connections, warnings };
    }
  }

  const { Project, Node } = tsMorphModule;

  const sourceFiles = await glob('**/*.{ts,tsx}', {
    cwd: projectRoot,
    ignore: ['node_modules/**', 'dist/**', 'build/**'],
    absolute: true,
  });

  const project = new Project({
    compilerOptions: { allowJs: true, skipLibCheck: true, noEmit: true },
    skipAddingFilesFromTsConfig: true,
  });

  for (const file of sourceFiles) {
    try {
      project.addSourceFileAtPath(file);
    } catch {
      // Skip unparseable files
    }
  }

  const foundTables = new Map<string, ArchitectureComponent>();
  const prismaOperations = ['findMany', 'findUnique', 'findFirst', 'create', 'update', 'delete', 'upsert', 'count'];

  // Helper to find containing function
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function findContainingFunction(node: any): string | undefined {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let current: any = node;
    while (current) {
      if (Node.isVariableDeclaration(current)) return current.getName();
      if (Node.isFunctionDeclaration(current)) return current.getName();
      if (Node.isMethodDeclaration(current)) return current.getName();
      current = current.getParent();
    }
    return undefined;
  }

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = path.relative(projectRoot, sourceFile.getFilePath());

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sourceFile.forEachDescendant((node: any) => {
      if (Node.isCallExpression(node)) {
        const text = node.getExpression().getText();
        const prismaMatch = text.match(/(\w+)\.(\w+)\.(\w+)/);

        if (prismaMatch) {
          const [, , tableName, operation] = prismaMatch;

          if (prismaOperations.includes(operation)) {
            if (!foundTables.has(tableName)) {
              const component: ArchitectureComponent = {
                component_id: generateComponentId('db-table', tableName),
                name: tableName,
                type: 'db-table',
                role: { purpose: `Database table: ${tableName}`, layer: 'database', critical: true },
                source: { detection_method: 'auto', config_files: [], confidence: 0.9 },
                connects_to: [],
                connected_from: [],
                status: 'active',
                tags: ['database', 'prisma', 'ast-detected'],
                timestamp,
                last_updated: timestamp,
              };
              foundTables.set(tableName, component);
              components.push(component);
            }

            const tableComponent = foundTables.get(tableName)!;
            const containingFunction = findContainingFunction(node);

            connections.push({
              connection_id: generateConnectionId('api-calls-db'),
              from: {
                component_id: `FILE:${filePath}`,
                location: { file: filePath, line: node.getStartLineNumber(), function: containingFunction },
              },
              to: { component_id: tableComponent.component_id },
              connection_type: 'api-calls-db',
              code_reference: {
                file: filePath,
                symbol: containingFunction || `${tableName}_${operation}`,
                symbol_type: 'function',
                line_start: node.getStartLineNumber(),
                code_snippet: node.getText().slice(0, 100),
              },
              description: `${operation} on ${tableName}`,
              detected_from: 'AST analysis (Prisma)',
              confidence: 0.95,
              timestamp,
              last_verified: timestamp,
            });
          }
        }
      }
    });
  }

  return { components, connections, warnings };
}
