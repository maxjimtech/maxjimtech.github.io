"""Authoritative native generation on a GitHub-hosted Windows runner."""
import json, os, pathlib, shutil, subprocess, sys, time, traceback
ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'engine'))
import FreeCAD as A, Part
from generate import run

def main():
    if os.environ.get('GITHUB_ACTIONS') != 'true':
        raise RuntimeError('Cloud-only worker: run with GitHub Actions, not on a client computer.')
    work = ROOT / 'work'
    out = work / 'output'
    c = json.loads((work / 'requirements.json').read_text(encoding='utf-8'))
    started = time.time()
    run(c, str(out))
    if (work/'runtime.json').exists():
        shutil.copyfile(work/'runtime.json',out/'runtime.json')
    # Preview uses saved STEP solids, never an invented display-only cam.
    shape = Part.Shape()
    shape.read(str(out / 'STEP/Assembly.step'))
    if not shape.isValid() or len(shape.Solids) != c['roller_count'] + 2:
        raise RuntimeError('Assembly preview source invalid')
    parts = []
    for i, solid in enumerate(shape.Solids):
        vertices, faces = solid.tessellate(0.25)
        parts.append({'name': 'Roller plate' if i == 0 else 'Cam shaft' if i == 1 else 'Roller ' + str(i-1),
                      'vertices': [[round(v.x, 4), round(v.y, 4), round(v.z, 4)] for v in vertices],
                      'faces': faces, 'color': ['#8ba4b7', '#d9a854', '#d3e0e7'][min(i, 2)]})
    (out / 'preview.json').write_text(json.dumps({'units': 'mm', 'parts': parts}, separators=(',', ':')), encoding='utf-8')
    subprocess.run([os.environ['PREVIEW_PYTHON'], '-B', str(ROOT / 'cloud/drawing_preview.py'), str(out)], check=True)
    (work / 'success.json').write_text(json.dumps({'elapsed_seconds': round(time.time()-started), 'freecad_version': A.Version(), 'project': c['project']}), encoding='utf-8')

if __name__ == '__main__':
    try:
        main()
    except Exception:
        (ROOT / 'work').mkdir(exist_ok=True)
        (ROOT / 'work/cloud_failure.txt').write_text(traceback.format_exc(), encoding='utf-8')
        raise
