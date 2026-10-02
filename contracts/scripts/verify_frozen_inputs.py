"""Check copied pinned dependencies and untouched Treasury inputs, portable offline."""
from pathlib import Path
import hashlib,json
ROOT=Path(__file__).resolve().parents[1]
manifest=json.loads((ROOT/'inputs/FROZEN_FILES.json').read_text())
for rel,expected in manifest.items():
    actual=hashlib.sha256((ROOT/rel).read_bytes()).hexdigest()
    assert actual==expected, f'Frozen input changed: {rel}'
print(json.dumps({'status':'PASS','frozen_files_verified':len(manifest)}))
