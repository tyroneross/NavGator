#!/usr/bin/env python3
"""
promote-lessons.py — NavGator cross-project lesson promoter.

Scans every project's `<project>/.navgator/lessons/lessons.json` and finds
patterns that recur in N+ distinct projects (default N=3). Same-pattern
lessons across enough projects become candidates for promotion to the
global lesson bank at `~/.navgator/lessons/global-lessons.json`.

Per-project lesson schema (`schema_version: "1.0.0"`):
    {
      "schema_version": "1.0.0",
      "lessons": [
        {
          "id": "lesson-<category>-<short-slug>",
          "category": "api-contract | data-flow | component-communication |
                       llm-architecture | infrastructure | typespec |
                       database-structure | doc-drift | platform-parity | other",
          "pattern": "human-readable description",
          "signature": ["regex1", "regex2", ...],
          "severity": "critical | important | minor",
          "context": {
            "first_seen": "ISO date",
            "last_seen": "ISO date",
            "occurrences": int,
            "files_affected": [...],
            "resolution": "..."
          },
          "example": { "bad": "...", "good": "...", "why": "..." },
          "validation": { "last_validated": "ISO date",
                          "source": "agent | <script>",
                          "status": "current | stale | unvalidated" }
        }
      ]
    }

Global lesson schema adds traceability fields:
    source_projects: [<project_name>, ...]
    promoted_at:    ISO date
    applies_to:     [<tag>, ...]   # union of category + heuristic tags
    promotion_signature: <hash>    # for idempotency / dedup

Match key: tuple (category, normalized_signature). Two lessons are "the same
pattern" when they share both category and a sorted, normalized signature
list. This is conservative — different signatures or categories are treated
as different patterns even if descriptions sound similar.

Behavior:
  - Default: dry-run. Prints the candidate list with contributing projects.
  - --write: backs up global-lessons.json then appends new merged entries.
            Idempotent — entries with a matching `promotion_signature` are
            skipped.
  - Read-only by default. No network. No mutation without --write.
"""

from __future__ import annotations

import argparse
import datetime as dt
import glob
import hashlib
import json
import os
import shutil
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any


SCAN_ROOT = Path.home() / "dev" / "git-folder"
LESSONS_GLOB = "*/.navgator/lessons/lessons.json"
GLOBAL_PATH = Path.home() / ".navgator" / "lessons" / "global-lessons.json"
DEFAULT_THRESHOLD = 3

SEVERITY_RANK = {"minor": 0, "important": 1, "critical": 2}


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d")


def project_name(lessons_path: Path) -> str:
    # .../<project>/.navgator/lessons/lessons.json -> <project>
    return lessons_path.parents[2].name


def load_json(path: Path) -> dict[str, Any] | None:
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        print(f"warn: skipping {path}: {e}", file=sys.stderr)
        return None


def normalize_signature(sig: list[str] | None) -> tuple[str, ...]:
    if not sig:
        return ()
    # Stable, order-insensitive key
    return tuple(sorted(s.strip() for s in sig if isinstance(s, str)))


def match_key(lesson: dict[str, Any]) -> tuple[str, tuple[str, ...]]:
    return (lesson.get("category", "other"), normalize_signature(lesson.get("signature")))


def severity_max(values: list[str]) -> str:
    if not values:
        return "important"
    return max(values, key=lambda v: SEVERITY_RANK.get(v, 0))


def promotion_signature(category: str, sig: tuple[str, ...]) -> str:
    payload = json.dumps({"category": category, "signature": list(sig)}, sort_keys=True)
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()[:12]


def collect(scan_root: Path) -> list[tuple[Path, dict[str, Any]]]:
    paths = sorted(scan_root.glob(LESSONS_GLOB))
    out: list[tuple[Path, dict[str, Any]]] = []
    for p in paths:
        data = load_json(p)
        if not data:
            continue
        out.append((p, data))
    return out


def build_candidates(
    project_files: list[tuple[Path, dict[str, Any]]],
    threshold: int,
) -> list[dict[str, Any]]:
    # Group lessons by match_key, tracking which projects contributed.
    groups: dict[tuple[str, tuple[str, ...]], list[tuple[str, dict[str, Any]]]] = defaultdict(list)
    for path, data in project_files:
        proj = project_name(path)
        for lesson in data.get("lessons", []):
            if not isinstance(lesson, dict):
                continue
            key = match_key(lesson)
            if not key[1]:  # skip lessons with no signature — can't safely merge
                continue
            groups[key].append((proj, lesson))

    candidates = []
    for (category, sig), entries in groups.items():
        # Distinct project count, not raw occurrence count
        projects = sorted({proj for proj, _ in entries})
        if len(projects) < threshold:
            continue
        severities = [l.get("severity", "important") for _, l in entries]
        merged_pattern = entries[0][1].get("pattern", "")  # take first as canonical
        files_union = sorted({
            f
            for _, l in entries
            for f in (l.get("context", {}) or {}).get("files_affected", [])
            if isinstance(f, str)
        })
        candidates.append({
            "category": category,
            "signature": list(sig),
            "promotion_signature": promotion_signature(category, sig),
            "severity": severity_max(severities),
            "pattern": merged_pattern,
            "source_projects": projects,
            "contributing_lessons": [
                {"project": proj, "id": l.get("id"), "pattern": l.get("pattern")}
                for proj, l in entries
            ],
            "files_affected_union": files_union,
        })
    candidates.sort(key=lambda c: (-len(c["source_projects"]), c["category"], c["pattern"]))
    return candidates


def category_cross_check(project_files: list[tuple[Path, dict[str, Any]]]) -> dict[str, list[str]]:
    """For each category, list projects that mention it. Useful even when no
    pattern reaches the 3+ threshold — surfaces categories trending toward
    promotion."""
    cat_projects: dict[str, set[str]] = defaultdict(set)
    for path, data in project_files:
        proj = project_name(path)
        for lesson in data.get("lessons", []):
            cat = lesson.get("category", "other")
            cat_projects[cat].add(proj)
    return {cat: sorted(projs) for cat, projs in sorted(cat_projects.items())}


def load_global(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"schema_version": "1.0.0", "project": "", "lessons": []}
    data = load_json(path)
    if not data:
        return {"schema_version": "1.0.0", "project": "", "lessons": []}
    data.setdefault("lessons", [])
    return data


def existing_signatures(global_data: dict[str, Any]) -> set[str]:
    sigs: set[str] = set()
    for lesson in global_data.get("lessons", []):
        ps = lesson.get("promotion_signature")
        if ps:
            sigs.add(ps)
            continue
        # Fall back to recomputing on the lesson's own (category, signature)
        # — covers manually-promoted entries that predate this script.
        cat = lesson.get("category", "other")
        sig = normalize_signature(lesson.get("signature"))
        if sig:
            sigs.add(promotion_signature(cat, sig))
    return sigs


def to_global_lesson(candidate: dict[str, Any]) -> dict[str, Any]:
    today = now_iso()
    lesson_id = f"prom-{candidate['promotion_signature']}"
    return {
        "id": lesson_id,
        "category": candidate["category"],
        "pattern": candidate["pattern"],
        "signature": candidate["signature"],
        "severity": candidate["severity"],
        "context": {
            "first_seen": today,
            "last_seen": today,
            "occurrences": len(candidate["contributing_lessons"]),
            "files_affected": candidate["files_affected_union"],
            "resolution": "Promoted from per-project lessons. See source_projects for context.",
        },
        "example": {"bad": "", "good": "", "why": ""},
        "validation": {
            "last_validated": today,
            "source": "promote-lessons.py",
            "status": "unvalidated",
        },
        "source_projects": candidate["source_projects"],
        "promoted_at": today,
        "applies_to": [candidate["category"]],
        "promotion_signature": candidate["promotion_signature"],
    }


def write_global(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    tmp.replace(path)


def backup_global(path: Path) -> Path | None:
    if not path.exists():
        return None
    ts = dt.datetime.now().strftime("%Y%m%dT%H%M%S")
    backup = path.with_suffix(path.suffix + f".bak.e3.{ts}")
    shutil.copy2(path, backup)
    return backup


def render_dry_run(
    candidates: list[dict[str, Any]],
    cat_check: dict[str, list[str]],
    threshold: int,
    project_files: list[tuple[Path, dict[str, Any]]],
) -> str:
    out: list[str] = []
    out.append(f"Scanned {len(project_files)} projects under {SCAN_ROOT}")
    out.append(f"Threshold: pattern must appear in {threshold}+ distinct projects to promote")
    out.append("")
    if not candidates:
        out.append("No patterns yet meet the promotion threshold.")
    else:
        out.append(f"Found {len(candidates)} promotion candidate(s):")
        out.append("")
        for i, c in enumerate(candidates, 1):
            out.append(f"  [{i}] category={c['category']} severity={c['severity']}")
            out.append(f"      pattern: {c['pattern']}")
            out.append(f"      signature: {c['signature']}")
            out.append(f"      projects ({len(c['source_projects'])}): {', '.join(c['source_projects'])}")
            out.append(f"      promotion_signature: {c['promotion_signature']}")
            out.append("")
    out.append("Cross-project category cross-check (categories appearing in 2+ projects):")
    any_two = False
    for cat, projs in cat_check.items():
        if len(projs) >= 2:
            any_two = True
            marker = "*" if len(projs) >= threshold else " "
            out.append(f"  {marker} {cat}: {len(projs)} projects → {', '.join(projs)}")
    if not any_two:
        out.append("  (none — every category is currently single-project)")
    out.append("")
    out.append("Run with --write to persist promotions to:")
    out.append(f"  {GLOBAL_PATH}")
    return "\n".join(out)


def render_write_summary(
    appended: list[dict[str, Any]],
    skipped: list[dict[str, Any]],
    backup: Path | None,
) -> str:
    out: list[str] = []
    if backup:
        out.append(f"Backup written: {backup}")
    out.append(f"Appended {len(appended)} new global lesson(s).")
    for lesson in appended:
        out.append(f"  + {lesson['id']} ({lesson['category']}) from {', '.join(lesson['source_projects'])}")
    if skipped:
        out.append(f"Skipped {len(skipped)} candidate(s) — already present in global bank:")
        for c in skipped:
            out.append(f"  - {c['promotion_signature']} ({c['category']})")
    return "\n".join(out)


def main() -> int:
    ap = argparse.ArgumentParser(description="Cross-project NavGator lesson promoter (read-only by default).")
    ap.add_argument("--scan-root", default=str(SCAN_ROOT),
                    help=f"Root directory to scan (default: {SCAN_ROOT})")
    ap.add_argument("--threshold", type=int, default=DEFAULT_THRESHOLD,
                    help=f"Minimum distinct projects required (default: {DEFAULT_THRESHOLD})")
    ap.add_argument("--write", action="store_true",
                    help="Apply promotions to global-lessons.json (default: dry-run)")
    ap.add_argument("--global-path", default=str(GLOBAL_PATH),
                    help="Path to global-lessons.json (default: ~/.navgator/lessons/global-lessons.json)")
    ap.add_argument("--json", action="store_true",
                    help="Emit machine-readable JSON instead of human text")
    args = ap.parse_args()

    scan_root = Path(args.scan_root).expanduser()
    global_path = Path(args.global_path).expanduser()

    project_files = collect(scan_root)
    candidates = build_candidates(project_files, args.threshold)
    cat_check = category_cross_check(project_files)

    if not args.write:
        if args.json:
            print(json.dumps({
                "mode": "dry-run",
                "scan_root": str(scan_root),
                "threshold": args.threshold,
                "projects_scanned": [project_name(p) for p, _ in project_files],
                "candidates": candidates,
                "category_cross_check": cat_check,
            }, indent=2))
        else:
            print(render_dry_run(candidates, cat_check, args.threshold, project_files))
        return 0

    # --write path
    global_data = load_global(global_path)
    have = existing_signatures(global_data)
    appended_lessons: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    for c in candidates:
        if c["promotion_signature"] in have:
            skipped.append(c)
            continue
        new_lesson = to_global_lesson(c)
        global_data["lessons"].append(new_lesson)
        appended_lessons.append(new_lesson)
        have.add(c["promotion_signature"])

    backup = None
    if appended_lessons:
        backup = backup_global(global_path)
        write_global(global_path, global_data)

    if args.json:
        print(json.dumps({
            "mode": "write",
            "backup": str(backup) if backup else None,
            "appended": appended_lessons,
            "skipped": [c["promotion_signature"] for c in skipped],
        }, indent=2))
    else:
        print(render_write_summary(appended_lessons, skipped, backup))
    return 0


if __name__ == "__main__":
    sys.exit(main())
