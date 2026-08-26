/**
 * Shared Prisma schema parser utility.
 *
 * Replaces the broken /model\s+(\w+)\s*\{([^}]*)\}/gs regex pattern used
 * across multiple scanners. That regex stops at the first `}`, silently
 * dropping fields that appear after nested braces such as @default({}) or
 * @relation({fields: [...], references: [...]}).
 *
 * This implementation uses a small lexer plus brace-depth counting to locate
 * active model declarations and their matching closing braces. The lexer
 * ignores comments and quoted strings so their contents cannot change parser
 * state or create phantom models.
 */

export interface ParsedPrismaModel {
  name: string;
  body: string; // raw body text between outer braces
}

type LexerState = 'normal' | 'line-comment' | 'block-comment' | 'string';

function isIdentifierCharacter(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_]/.test(character);
}

function isEscaped(content: string, index: number): boolean {
  let backslashCount = 0;
  for (let i = index - 1; i >= 0 && content[i] === '\\'; i--) {
    backslashCount++;
  }
  return backslashCount % 2 === 1;
}

function matchModelDeclaration(
  content: string,
  index: number,
): { name: string; bodyStart: number } | null {
  if (
    !content.startsWith('model', index) ||
    isIdentifierCharacter(content[index - 1]) ||
    isIdentifierCharacter(content[index + 'model'.length])
  ) {
    return null;
  }

  const match = /^model\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/.exec(content.slice(index));
  if (!match) return null;

  return {
    name: match[1],
    bodyStart: index + match[0].length,
  };
}

function findModelEnd(content: string, bodyStart: number): number | null {
  let depth = 1;
  let state: LexerState = 'normal';

  for (let i = bodyStart; i < content.length; i++) {
    const character = content[i];
    const nextCharacter = content[i + 1];

    if (state === 'line-comment') {
      if (character === '\n' || character === '\r') state = 'normal';
      continue;
    }

    if (state === 'block-comment') {
      if (character === '*' && nextCharacter === '/') {
        state = 'normal';
        i++;
      }
      continue;
    }

    if (state === 'string') {
      if (character === '"' && !isEscaped(content, i)) state = 'normal';
      continue;
    }

    if (character === '/' && nextCharacter === '/') {
      state = 'line-comment';
      i++;
    } else if (character === '/' && nextCharacter === '*') {
      state = 'block-comment';
      i++;
    } else if (character === '"') {
      state = 'string';
    } else if (character === '{') {
      depth++;
    } else if (character === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }

  return null;
}

/**
 * Parse Prisma schema content into model blocks using brace-depth counting.
 * Handles nested braces like @default({}) correctly.
 */
export function parsePrismaModels(content: string): ParsedPrismaModel[] {
  const models: ParsedPrismaModel[] = [];
  let state: LexerState = 'normal';
  let topLevelDepth = 0;

  for (let i = 0; i < content.length; i++) {
    const character = content[i];
    const nextCharacter = content[i + 1];

    if (state === 'line-comment') {
      if (character === '\n' || character === '\r') state = 'normal';
      continue;
    }

    if (state === 'block-comment') {
      if (character === '*' && nextCharacter === '/') {
        state = 'normal';
        i++;
      }
      continue;
    }

    if (state === 'string') {
      if (character === '"' && !isEscaped(content, i)) state = 'normal';
      continue;
    }

    if (character === '/' && nextCharacter === '/') {
      state = 'line-comment';
      i++;
      continue;
    }
    if (character === '/' && nextCharacter === '*') {
      state = 'block-comment';
      i++;
      continue;
    }
    if (character === '"') {
      state = 'string';
      continue;
    }

    if (topLevelDepth === 0) {
      const declaration = matchModelDeclaration(content, i);
      if (declaration) {
        const bodyEnd = findModelEnd(content, declaration.bodyStart);
        if (bodyEnd === null) break;

        models.push({
          name: declaration.name,
          body: content.substring(declaration.bodyStart, bodyEnd),
        });
        i = bodyEnd;
        continue;
      }
    }

    if (character === '{') topLevelDepth++;
    else if (character === '}' && topLevelDepth > 0) topLevelDepth--;
  }

  return models;
}
