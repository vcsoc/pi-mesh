#!/usr/bin/env python3
import json
import sys
from datetime import datetime, timezone
from pathlib import Path


def main(argv):
    if len(argv) < 2:
        print('Usage: bootstrap-manifest.py <project-name> [output-path]', file=sys.stderr)
        return 1
    project_name = argv[1]
    output = Path(argv[2] if len(argv) > 2 else '.testit/test-manifest.json')
    output.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        'projectName': project_name,
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'sourcePath': str(Path.cwd()),
        'technologies': [],
        'features': [],
        'tests': [],
    }
    output.write_text(json.dumps(payload, indent=2) + '\n', encoding='utf-8')
    print(f'Wrote {output}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv))
