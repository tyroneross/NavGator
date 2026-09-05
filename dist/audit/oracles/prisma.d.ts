/**
 * prisma oracle — truth frame: models declared in the Prisma schema.
 *
 * Strength:
 *   'independent' when `@prisma/internals` getDMMF resolves from the TARGET
 *   repo's node_modules (the compiler's own parse of the schema) — only with
 *   an explicit opt-in (`--trust-target-deps` / NAVGATOR_TRUST_TARGET_DEPS=1)
 *   because that is code execution from the audited repo;
 *   'weak' when we fall back to an independent regex (`^\s*model\s+(\w+)` plus
 *   `@@map("…")`), which is a re-derivation, not a second source.
 *
 * Map side: every `database` component. Prisma-model components (primary
 * config file ends in .prisma) are matched by model name or @@map table name.
 * Known client libraries typed `database` (Run 4 finding: @prisma/client,
 * ioredis, pg, redis, prisma, Supabase) are counted as false positives with
 * note `client-library-misclassified`; any other non-schema `database`
 * component is a false positive with note `not-a-schema-model`.
 */
import { type OracleInput, type OracleResult } from './common.js';
/** Client libraries / hosted DB services the npm and service scanners type as `database`. */
export declare const DATABASE_CLIENT_LIBRARIES: Set<string>;
export interface PrismaTruth {
    models: Array<{
        name: string;
        dbName?: string;
    }>;
    strength: 'independent' | 'weak';
    files: string[];
    note?: string;
}
/** Independent regex parse: `model Name {` … `@@map("table")` inside the block. */
export declare function regexModels(datamodel: string): Array<{
    name: string;
    dbName?: string;
}>;
export declare function loadPrismaTruth(root: string, opts?: {
    trustTargetDeps?: boolean;
}): Promise<PrismaTruth | null>;
export declare function prismaOracle(input: OracleInput, opts?: {
    trustTargetDeps?: boolean;
}): Promise<OracleResult>;
//# sourceMappingURL=prisma.d.ts.map