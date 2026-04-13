// SCIP resolves through the import. Many regex scanners that match
// `import\(['"]([^'"]+)['"]\)` strictly stop at quotes; here we use a
// computed-name pattern that requires resolution.
const modName = './source.js';
const m: typeof import('./source.js') = await import(modName);
export const out = m.greet('world');
