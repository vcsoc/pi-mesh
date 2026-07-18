#!/usr/bin/env python3
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

SECTIONS = [
    "routes",
    "apis",
    "services",
    "schemas",
    "workers",
    "forms",
    "integrations",
    "auth",
    "admin",
    "cli",
]


def main(argv):
    output = Path(argv[1] if len(argv) > 1 else '.testit/discovery-inventory.json')
    output.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourcePath": str(Path.cwd()),
        "summary": {"totalSurfaces": 0, "notes": []},
        "surfaces": {name: [] for name in SECTIONS},
    }
    output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {output}")
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv))
