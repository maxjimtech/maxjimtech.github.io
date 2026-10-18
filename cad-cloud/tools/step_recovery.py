"""Test closed-shell reconstruction and full STEP exporter on cloud evidence."""
import json, os, pathlib, sys, traceback
if os.environ.get('GITHUB_ACTIONS')!='true':raise RuntimeError('Cloud runner only')
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'engine'))
import FreeCAD as A, Part, Import, native_features
out=ROOT/'diagnostic';out.mkdir(exist_ok=True)
file=next((ROOT/'recovery').rglob('CamShaft.step'));rows=[]
def record(name,s):
    row={'name':name,'valid':s.isValid(),'closed':s.isClosed(),'solids':len(s.Solids),'shells':len(s.Shells),'volume':s.Volume,
         'shell_closed':[x.isClosed() for x in s.Shells],'bbox':[s.BoundBox.XMin,s.BoundBox.XMax,s.BoundBox.YMin,s.BoundBox.YMax,s.BoundBox.ZMin,s.BoundBox.ZMax]}
    print(json.dumps(row),flush=True);rows.append(row)
    (out/'recovery.json').write_text(json.dumps(rows,indent=2))
    return row
s=Part.Shape();s.read(str(file));record('cam imported',s)
for tolerance in [.001,.01,.1]:
    try:
        fixed=s.copy();fixed.fix(tolerance,tolerance/10,tolerance*10);record('fixed shell '+str(tolerance),fixed)
        if len(fixed.Shells)==1 and fixed.Shells[0].isClosed():
            solid=Part.makeSolid(fixed.Shells[0]);record('reconstructed solid '+str(tolerance),solid)
            p=out/('Solid_'+str(tolerance)+'.step');solid.exportStep(str(p));r=Part.Shape();r.read(str(p));record('reconstructed reread '+str(tolerance),r)
    except Exception:traceback.print_exc()
fc=next(p for p in file.parent.parent.glob('*.FCStd') if not p.name.startswith(('FAILED','NativeGeometry')))
doc=A.openDocument(str(fc));cam=next(o for o in doc.Objects if o.Label.startswith('1A Cam shaft'))
record('native',cam.Shape)
for mode in ['full_export','native_fix']:
    try:
        if mode=='full_export':
            p=out/'FullExporter.step';Import.export([cam],str(p))
        else:
            fixed=cam.Shape.copy();fixed.fix(.001,.0001,.1);record('native fixed',fixed)
            p=out/'NativeFixed.step';fixed.exportStep(str(p))
        r=Part.Shape();r.read(str(p));record(mode+' reread',r)
    except Exception:traceback.print_exc()
A.closeDocument(doc.Name)
