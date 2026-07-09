import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { scanImports } from '../scanners/connections/import-scanner.js';

describe('nested TypeScript path aliases', () => {
  it('uses the nearest owning config for @ aliases and generic path prefixes', async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'navgator-nested-alias-'));

    try {
      fs.mkdirSync(path.join(projectRoot, 'src', 'components'), { recursive: true });
      fs.mkdirSync(path.join(projectRoot, 'web', 'app'), { recursive: true });
      fs.mkdirSync(path.join(projectRoot, 'web', 'components'), { recursive: true });
      fs.mkdirSync(path.join(projectRoot, 'web', 'lib'), { recursive: true });

      // The root alias deliberately points elsewhere. The importer under web/
      // must use web/tsconfig.json, not this repository-level config.
      fs.writeFileSync(path.join(projectRoot, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: { '@/*': ['src/*'] },
        },
      }));
      fs.writeFileSync(path.join(projectRoot, 'web', 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@/*': ['./*'],
            'shared/*': ['./lib/*'],
          },
        },
      }));

      fs.writeFileSync(path.join(projectRoot, 'src', 'components', 'Button.ts'), 'export const wrongButton = true;\n');
      fs.writeFileSync(path.join(projectRoot, 'web', 'components', 'Button.ts'), 'export const Button = true;\n');
      fs.writeFileSync(path.join(projectRoot, 'web', 'lib', 'value.ts'), 'export const value = 42;\n');
      fs.writeFileSync(
        path.join(projectRoot, 'web', 'app', 'page.ts'),
        [
          "import { Button } from '@/components/Button';",
          "import { value } from 'shared/value';",
          'export const page = { Button, value };',
          '',
        ].join('\n')
      );

      const sourceFiles = [
        'src/components/Button.ts',
        'web/app/page.ts',
        'web/components/Button.ts',
        'web/lib/value.ts',
      ];
      const result = await scanImports(projectRoot, sourceFiles);
      const importsFromPage = new Map(
        result.connections
          .filter(connection => connection.connection_type === 'imports')
          .filter(connection => connection.code_reference?.file === 'web/app/page.ts')
          .map(connection => [connection.code_reference?.symbol, connection.to.location?.file])
      );

      expect(importsFromPage.get('@/components/Button')).toBe('web/components/Button.ts');
      expect(importsFromPage.get('shared/value')).toBe('web/lib/value.ts');
      expect(importsFromPage.get('@/components/Button')).not.toBe('src/components/Button.ts');
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
