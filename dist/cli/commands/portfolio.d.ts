/**
 * NavGator Portfolio Command
 *
 * `navgator portfolio [dir]` — scan a folder of repos and build a cross-repo
 * map (shared dependencies, heuristic service-call edges, portfolio status).
 * With no `dir`, reports status over already-registered projects without
 * scanning anything.
 *
 * Registration is C8's (docs/plans/2026-08-03-portfolio-remote-gitaware.md):
 * this module only exports `registerPortfolioCommand`.
 */
import { Command } from 'commander';
export declare function registerPortfolioCommand(program: Command): void;
//# sourceMappingURL=portfolio.d.ts.map