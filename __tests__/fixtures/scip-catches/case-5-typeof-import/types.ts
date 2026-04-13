// Pure type-position import — `import` here is the type-only form, no
// runtime side-effect. Regex scanners often miss this; SCIP indexes it.
export type DbUser = Awaited<ReturnType<typeof import('./db.js').prisma.user.findMany>>[number];
