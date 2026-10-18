"""Locate topology damage in a preserved native candidate, on a hosted runner."""
import json, os, pathlib, sys, traceback
if os.environ.get('GITHUB_ACTIONS') != 'true':
    raise RuntimeError('GitHub-hosted diagnostic only.')
root = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root/'engine'))
import FreeCAD as A, Part, native_features
out = root/'feature-audit';out.mkdir(exist_ok=True)
fc = next(p for p in (root/'recovery').rglob('*.FCStd') if not p.name.startswith(('FAILED', 'NativeGeometry')))
doc = A.openDocument(str(fc));rows = []
names = ['ShaftCentreHoles']+[o.Name for o in doc.Objects if o.Name.startswith('CNCGrooveCut_')]
names += ['LowerContinuousEdgeChamfer', 'UpperContinuousEdgeChamfer', 'CamLeftEndC', 'CamRightEndC', 'LeftShaftEndC']
for name in names:
    obj = doc.getObject(name)
    if obj is None:continue
    try:
        source = obj.Shape
        path = out/'feature.step';source.exportStep(str(path))
        restored = Part.Shape();restored.read(str(path))
        row = {'feature': name, 'native_valid': source.isValid(), 'native_solids': len(source.Solids),
               'native_faces': len(source.Faces), 'step_valid': restored.isValid(),
               'step_solids': len(restored.Solids), 'step_closed': all(s.isClosed() for s in restored.Solids),
               'native_volume': source.Volume, 'step_volume': restored.Volume}
        print('FEATURE_STEP '+json.dumps(row), flush=True);rows.append(row)
        (out/'feature-audit.json').write_text(json.dumps(rows, indent=2))
    except Exception:
        traceback.print_exc();rows.append({'feature': name, 'error': traceback.format_exc()})
        (out/'feature-audit.json').write_text(json.dumps(rows, indent=2))
A.closeDocument(doc.Name)
