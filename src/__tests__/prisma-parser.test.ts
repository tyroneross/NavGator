import { describe, it, expect } from 'vitest';
import { parsePrismaModels } from '../scanners/infrastructure/prisma-parser.js';
import { parseDatasource } from '../scanners/infrastructure/prisma-scanner.js';

describe('parsePrismaModels', () => {
  it('parses a model with no nested braces — all fields captured', () => {
    const schema = `
model User {
  id    String @id @default(cuid())
  email String @unique
  name  String?
}
`;
    const models = parsePrismaModels(schema);
    expect(models).toHaveLength(1);
    expect(models[0].name).toBe('User');
    expect(models[0].body).toContain('id');
    expect(models[0].body).toContain('email');
    expect(models[0].body).toContain('name');
  });

  it('parses a model with @default({}) — fields AFTER nested brace are captured', () => {
    const schema = `
model Settings {
  id      String @id @default(cuid())
  meta    Json   @default({})
  active  Boolean @default(true)
  label   String
}
`;
    const models = parsePrismaModels(schema);
    expect(models).toHaveLength(1);
    expect(models[0].name).toBe('Settings');
    // Fields after the nested {} must be present
    expect(models[0].body).toContain('active');
    expect(models[0].body).toContain('label');
  });

  it('parses a model with @relation({fields: [...], references: [...]}) — not truncated', () => {
    const schema = `
model Post {
  id       String @id @default(cuid())
  authorId String
  author   User   @relation(fields: [authorId], references: [id])
  title    String
}
`;
    const models = parsePrismaModels(schema);
    expect(models).toHaveLength(1);
    expect(models[0].name).toBe('Post');
    expect(models[0].body).toContain('author');
    expect(models[0].body).toContain('title');
  });

  it('parses a model with @@map and @@index — both captured in body', () => {
    const schema = `
model UserProfile {
  id     String @id @default(cuid())
  userId String @unique

  @@map("user_profiles")
  @@index([userId])
}
`;
    const models = parsePrismaModels(schema);
    expect(models).toHaveLength(1);
    expect(models[0].name).toBe('UserProfile');
    expect(models[0].body).toContain('@@map');
    expect(models[0].body).toContain('@@index');
  });

  it('parses a multi-model schema — all models returned with correct names', () => {
    const schema = `
model User {
  id    String @id
  email String @unique
}

model Post {
  id      String @id
  title   String
  meta    Json   @default({})
  content String
}

model Comment {
  id   String @id
  body String
}
`;
    const models = parsePrismaModels(schema);
    expect(models).toHaveLength(3);
    expect(models.map(m => m.name)).toEqual(['User', 'Post', 'Comment']);
    // Post's fields after nested {} must be captured
    expect(models[1].body).toContain('content');
  });

  it('returns empty array for empty content without throwing', () => {
    expect(parsePrismaModels('')).toEqual([]);
    expect(parsePrismaModels('   ')).toEqual([]);
  });

  it('returns empty array for malformed content without throwing', () => {
    expect(parsePrismaModels('model Broken {')).toEqual([]);
    expect(parsePrismaModels('not a prisma schema at all')).toEqual([]);
  });

  it('handles @default(dbgenerated("gen_random_uuid()")) — not broken by parens', () => {
    const schema = `
model Entity {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  createdAt DateTime @default(now())
  value     String
}
`;
    const models = parsePrismaModels(schema);
    expect(models).toHaveLength(1);
    expect(models[0].name).toBe('Entity');
    expect(models[0].body).toContain('id');
    expect(models[0].body).toContain('createdAt');
    expect(models[0].body).toContain('value');
  });

  it('handles multiple nested braces in a single field', () => {
    const schema = `
model Config {
  id      String @id @default(cuid())
  data    Json   @default({"key": "value", "nested": {}})
  enabled Boolean
}
`;
    const models = parsePrismaModels(schema);
    expect(models).toHaveLength(1);
    expect(models[0].body).toContain('enabled');
  });

  it('does not decrement depth for } inside a string literal', () => {
    const schema = `
model Msg {
  id   String @id
  text String @default("say } here")
  done Boolean
}
`;
    const models = parsePrismaModels(schema);
    expect(models).toHaveLength(1);
    expect(models[0].body).toContain('done');
  });

  it('handles string literal with { and } inside @default', () => {
    const schema = `
model Template {
  id       String @id
  pattern  String @default("{name} is {age}")
  fallback String
}
`;
    const models = parsePrismaModels(schema);
    expect(models).toHaveLength(1);
    expect(models[0].body).toContain('fallback');
  });
});

describe('parseDatasource', () => {
  it('extracts postgresql provider and maps to postgres engine', () => {
    const schema = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
`;
    const result = parseDatasource(schema);
    expect(result).not.toBeNull();
    expect(result!.engine).toBe('postgres');
    expect(result!.connection_env_var).toBe('DATABASE_URL');
  });

  it('extracts mysql provider', () => {
    const schema = `
datasource db {
  provider = "mysql"
  url      = env("MYSQL_URL")
}
`;
    const result = parseDatasource(schema);
    expect(result).not.toBeNull();
    expect(result!.engine).toBe('mysql');
    expect(result!.connection_env_var).toBe('MYSQL_URL');
  });

  it('extracts sqlite provider', () => {
    const schema = `
datasource db {
  provider = "sqlite"
  url      = "file:./dev.db"
}
`;
    const result = parseDatasource(schema);
    expect(result).not.toBeNull();
    expect(result!.engine).toBe('sqlite');
    // url is not env(), so no connection_env_var
    expect(result!.connection_env_var).toBeUndefined();
  });

  it('extracts mongodb provider', () => {
    const schema = `
datasource db {
  provider = "mongodb"
  url      = env("MONGODB_URI")
}
`;
    const result = parseDatasource(schema);
    expect(result).not.toBeNull();
    expect(result!.engine).toBe('mongodb');
    expect(result!.connection_env_var).toBe('MONGODB_URI');
  });

  it('extracts env var from url = env("DATABASE_URL")', () => {
    const schema = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
`;
    const result = parseDatasource(schema);
    expect(result!.connection_env_var).toBe('DATABASE_URL');
  });

  it('extracts url env var when directUrl is also present', () => {
    const schema = `
datasource db {
  provider    = "postgresql"
  url         = env("DATABASE_URL")
  directUrl   = env("DIRECT_DATABASE_URL")
}
`;
    const result = parseDatasource(schema);
    expect(result).not.toBeNull();
    // url takes precedence over directUrl
    expect(result!.connection_env_var).toBe('DATABASE_URL');
  });

  it('returns null when no datasource block is present', () => {
    const schema = `
model User {
  id    String @id
  email String @unique
}
`;
    const result = parseDatasource(schema);
    expect(result).toBeNull();
  });

  it('returns null for empty content', () => {
    expect(parseDatasource('')).toBeNull();
    expect(parseDatasource('   ')).toBeNull();
  });

  it('handles cockroachdb provider', () => {
    const schema = `
datasource db {
  provider = "cockroachdb"
  url      = env("COCKROACH_URL")
}
`;
    const result = parseDatasource(schema);
    expect(result).not.toBeNull();
    expect(result!.engine).toBe('cockroachdb');
    expect(result!.connection_env_var).toBe('COCKROACH_URL');
  });
});
