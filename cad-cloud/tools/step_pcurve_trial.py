"""Compare STEP curve representations against the unchanged native snapshot."""
import json, os, pathlib, sys, traceback
if os.environ.get('GITHUB_ACTIONS') != 'true':raise RuntimeError('Cloud runner only.')
root=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'engine'))
import FreeCAD as A, Part, native_features
out=root/'pcurve-trial';out.mkdir(exist_ok=True);rows=[]
fc=next((root/'recovery').rglob('NativeGeometry.FCStd'),None)
if fc is None:fc=next(p for p in (root/'recovery').rglob('*.FCStd') if not p.name.startswith('FAILED'))
doc=A.openDocument(str(fc));cam=next(o for o in doc.Objects if o.Label.startswith('1A Cam shaft'))
Part.makeBox(1,1,1).exportStep(str(out/'initialize.step'))
print('NATIVE',cam.Shape.isValid(),cam.Shape.Volume,flush=True)
for mode in [0,1]:
    try:
        setting=Part.setStaticValue('write.surfacecurve.mode',mode)
        path=out/('Cam_surfacecurve_'+str(mode)+'.step');cam.Shape.exportStep(str(path))
        restored=Part.Shape();restored.read(str(path))
        row={'mode':mode,'setting_result':setting,'valid':restored.isValid(),'solids':len(restored.Solids),
             'closed':all(s.isClosed() for s in restored.Solids),'source_volume':cam.Shape.Volume,'step_volume':restored.Volume}
        print('PCURVE_TRIAL '+json.dumps(row),flush=True);rows.append(row)
        (out/'pcurve-trial.json').write_text(json.dumps(rows,indent=2))
    except Exception:traceback.print_exc()
A.closeDocument(doc.Name)
