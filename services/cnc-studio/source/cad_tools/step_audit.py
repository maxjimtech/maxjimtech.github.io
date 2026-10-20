"""Runs in an isolated FreeCAD Python process; no Solid Edge session mutation."""
import argparse
import json
from pathlib import Path
import sys

# FreeCAD initializes/injects modules into __main__. Initialize it before defining
# application functions so its stdlib `inspect` module cannot replace our callable.
import FreeCAD
import Part

from core import digest, save, stamp


def audit_step_shape(path):
    shape = Part.read(str(path))
    if shape.isNull():
        raise ValueError('Empty STEP shape')
    b = shape.BoundBox
    return {'path': str(path), 'sha256': digest(path), 'valid': shape.isValid(),
            'solid_count': len(shape.Solids), 'shell_count': len(shape.Shells),
            'face_count': len(shape.Faces), 'volume_mm3': shape.Volume,
            'bounds_mm': [b.XMin, b.YMin, b.ZMin, b.XMax, b.YMax, b.ZMax],
            'size_mm': [b.XLength, b.YLength, b.ZLength],
            'closed_solids': all(s.isClosed() for s in shape.Solids),
            'all_shells_closed': all(s.isClosed() for s in shape.Shells),
            'standalone_faces': len(shape.Faces) - sum(len(s.Faces) for s in shape.Solids)}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('inputs', nargs='+')
    p.add_argument('--output', required=True)
    args = p.parse_args()
    files = []
    for name in args.inputs:
        path = Path(name).resolve()
        files.extend(sorted(x for x in path.rglob('*') if x.suffix.lower() in ('.step', '.stp')) if path.is_dir() else [path])
    rows = []
    for path in dict.fromkeys(files):
        try:
            row = audit_step_shape(path)
            row['pass'] = (row['valid'] and row['solid_count'] > 0 and row['closed_solids']
                           and row['all_shells_closed'] and row['standalone_faces'] == 0 and row['volume_mm3'] > 0)
        except Exception as e:
            row = {'path': str(path), 'pass': False, 'error': str(e)}
        rows.append(row)
    passed = bool(rows) and all(r['pass'] for r in rows)
    save(args.output, {'created_at': stamp(), 'pass': passed, 'files': rows,
                       'scope': 'Independent STEP geometry only; no native editability, assembly links, physical qualification.'})
    print(json.dumps({'pass': passed, 'files': len(rows)}, ensure_ascii=False))
    return 0 if passed else 1


if __name__ == '__main__':
    sys.exit(main())
