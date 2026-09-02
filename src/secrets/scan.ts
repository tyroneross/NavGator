/**
 * Scan orchestrator: runs every available SecretEngine over `paths`, merges
 * findings that are the same underlying secret (same `hash`) across engines,
 * and returns a deterministic SecretScanResult.
 *
 * Engine disagreement — which engines found a given secret and which didn't —
 * is the doctor's core cross-check signal, so merged findings carry a
 * `foundBy: string[]` field. The frozen SecretFinding contract in `types.ts`
 * does not have this field (and must not be edited to add it), so it is
 * exported here as a local extension, `MergedSecretFinding`.
 */

import type {
  DetectorSpecificity,
  SecretEngine,
  SecretFinding,
  SecretLocation,
  SecretScanResult,
} from './types.js';
import { enumerateFiles, NativeEngine, TruffleHogEngine, VaultEngine } from './engines/index.js';

/** A SecretFinding plus which engine id(s) independently produced it. */
export interface MergedSecretFinding extends SecretFinding {
  foundBy: string[];
}

export interface RunSecretScanOptions {
  /** Engine ids to run. Defaults to all registered engines. Unknown ids are
   * silently ignored (not an error) rather than failing the whole scan. */
  engines?: string[];
}

const SPECIFICITY_RANK: Record<DetectorSpecificity, number> = {
  structured: 0,
  heuristic: 1,
  entropy: 2,
};

/** The more specific (lower-rank) of two specificities. When two engines
 * disagree on how confident a match is, the merged finding keeps whichever
 * engine actually knew more — never silently drops the better answer. */
function mostSpecific(a: DetectorSpecificity, b: DetectorSpecificity): DetectorSpecificity {
  return SPECIFICITY_RANK[a] <= SPECIFICITY_RANK[b] ? a : b;
}

function locationKey(loc: SecretLocation): string {
  return `${loc.file}::${loc.line ?? ''}::${loc.corpus}`;
}

function registerEngines(): SecretEngine[] {
  return [new NativeEngine(), new TruffleHogEngine(), new VaultEngine()];
}

/** One engine's raw findings, ready to fold into the merge. */
export interface EngineFindingBatch {
  engineId: string;
  findings: SecretFinding[];
}

/**
 * Merges findings that are the same underlying secret (same `hash`) across
 * engines into one `MergedSecretFinding` each: locations are unioned,
 * occurrences summed, specificity kept at the more confident of the two, and
 * `foundBy` records every engine that independently produced the hash.
 * Output is sorted by (secretClass, hash) — and each finding's `locations`/
 * `foundBy` are sorted too — so identical input is byte-identical on repeat
 * calls. Pure and synchronous: exported separately from `runSecretScan` so it
 * is testable without any engine actually running.
 */
export function mergeFindings(batches: EngineFindingBatch[]): MergedSecretFinding[] {
  const merged = new Map<string, MergedSecretFinding>();

  for (const { engineId, findings } of batches) {
    for (const finding of findings) {
      const existing = merged.get(finding.hash);
      if (!existing) {
        merged.set(finding.hash, { ...finding, locations: [...finding.locations], foundBy: [engineId] });
        continue;
      }

      if (!existing.foundBy.includes(engineId)) existing.foundBy.push(engineId);

      const seenLocations = new Set(existing.locations.map(locationKey));
      for (const loc of finding.locations) {
        const key = locationKey(loc);
        if (!seenLocations.has(key)) {
          existing.locations.push(loc);
          seenLocations.add(key);
        }
      }

      existing.occurrences += finding.occurrences;
      existing.specificity = mostSpecific(existing.specificity, finding.specificity);

      if (finding.firstSeen && (!existing.firstSeen || finding.firstSeen < existing.firstSeen)) {
        existing.firstSeen = finding.firstSeen;
      }
      if (finding.lastSeen && (!existing.lastSeen || finding.lastSeen > existing.lastSeen)) {
        existing.lastSeen = finding.lastSeen;
      }
    }
  }

  const result = Array.from(merged.values());

  for (const f of result) {
    f.foundBy.sort();
    f.locations.sort((a, b) => {
      if (a.file !== b.file) return a.file < b.file ? -1 : 1;
      return (a.line ?? 0) - (b.line ?? 0);
    });
  }
  result.sort((a, b) => {
    if (a.secretClass !== b.secretClass) return a.secretClass < b.secretClass ? -1 : 1;
    return a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0;
  });

  return result;
}

export async function runSecretScan(paths: string[], opts: RunSecretScanOptions = {}): Promise<SecretScanResult> {
  const start = Date.now();

  const allEngines = registerEngines();
  const engines = opts.engines ? allEngines.filter((e) => opts.engines!.includes(e.id)) : allEngines;

  const capabilities = await Promise.all(engines.map((e) => e.capability()));

  const batches: EngineFindingBatch[] = [];
  for (let i = 0; i < engines.length; i++) {
    const engine = engines[i];
    const capability = capabilities[i];
    if (!capability.available) continue;

    try {
      batches.push({ engineId: engine.id, findings: await engine.scan(paths) });
    } catch {
      // One engine failing must not fail the whole scan — the deterministic
      // core keeps going with whatever engines are healthy.
      batches.push({ engineId: engine.id, findings: [] });
    }
  }

  return {
    findings: mergeFindings(batches),
    engines: capabilities,
    scannedPaths: [...paths],
    filesScanned: enumerateFiles(paths).length,
    durationMs: Date.now() - start,
  };
}
