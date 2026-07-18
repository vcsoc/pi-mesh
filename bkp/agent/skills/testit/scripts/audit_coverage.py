#!/usr/bin/env python3
import json
import sys
from pathlib import Path


def load(path: Path):
    with path.open('r', encoding='utf-8') as f:
        return json.load(f)


def collect_discovered_surfaces(discovery: dict):
    surfaces = []
    for category, items in (discovery.get('surfaces') or {}).items():
        for item in items or []:
            item_id = item.get('id') or item.get('path') or item.get('name')
            if item_id:
                surfaces.append((category, str(item_id)))
    return surfaces


def collect_covered_surfaces(matrix: dict):
    covered = set()
    explicit_gaps = set()
    for entry in matrix.get('surfaces', []) or []:
        key = (entry.get('category', 'unknown'), str(entry.get('id') or entry.get('path') or entry.get('name')))
        tests = entry.get('tests') or []
        gaps = entry.get('gaps') or []
        if tests:
            covered.add(key)
        if gaps:
            explicit_gaps.add(key)
    return covered, explicit_gaps


def main(argv):
    base = Path(argv[1] if len(argv) > 1 else '.testit')
    discovery_path = base / 'discovery-inventory.json'
    matrix_path = base / 'coverage-matrix.json'
    score_path = base / 'coverage-score.json'

    if not discovery_path.exists():
        print('FAIL: missing discovery-inventory.json')
        return 2
    if not matrix_path.exists():
        print('FAIL: missing coverage-matrix.json')
        return 2

    discovery = load(discovery_path)
    matrix = load(matrix_path)
    score = load(score_path) if score_path.exists() else None

    discovered = collect_discovered_surfaces(discovery)
    covered, gaps = collect_covered_surfaces(matrix)

    missing = [item for item in discovered if item not in covered and item not in gaps]
    total = len(discovered)
    covered_count = len([item for item in discovered if item in covered])
    gap_count = len([item for item in discovered if item in gaps])

    print(f'Discovered surfaces: {total}')
    print(f'Covered surfaces:    {covered_count}')
    print(f'Gap-reported:        {gap_count}')
    print(f'Unaccounted:         {len(missing)}')

    if score:
        print(f"Coverage score:      {score.get('overallScore', '?')}/{score.get('maxScore', '?')}")

    if total >= 20 and covered_count < max(10, total // 4):
        print('FAIL: suspiciously low coverage relative to discovered surfaces')
        return 3

    if missing:
        print('FAIL: discovered surfaces missing from both tests and explicit gaps:')
        for category, item_id in missing[:50]:
            print(f' - [{category}] {item_id}')
        return 4

    print('PASS: no unaccounted discovered surfaces found')
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv))
