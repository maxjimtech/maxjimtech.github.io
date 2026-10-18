"""Cloud-only STEP round-trip investigation using preserved failure evidence."""
import json, os, pathlib, sys, traceback
if os.environ.get('GITHUB_ACTIONS') != 'true':
    raise RuntimeError('Run on a hosted cloud runner only')
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'engine'))
import FreeCAD as A, Part, native_features
out=ROOT/'diagnostic';out.mkdir(exist_ok=True)
sources=list((ROOT/'recovery').rglob('Assembly.step'))
if len(sources)!=1:raise RuntimeError('Expected one preserved assembly')
folder=sources[0].parent
report=[]
def inspect(name,s):
    row={'name':name,'valid':s.isValid(),'solids':len(s.Solids),'shells':len(s.Shells),'volume':s.Volume,
         'invalid_solids':[i for i,x in enumerate(s.Solids) if not x.isValid()]}
    print(json.dumps(row),flush=True);report.append(row)
    if not row['valid']:
        try:print('SHAPE_CHECK '+str(s.check()),flush=True)
        except Exception as e:print('SHAPE_CHECK '+str(e),flush=True)
    return row
for file in sorted(folder.glob('*.step')):
    s=Part.Shape();s.read(str(file));row=inspect(file.name,s)
    if not row['valid']:
        for tolerance in [.0001,.001,.01]:
            repaired=s.copy()
            try:
                ok=repaired.fix(tolerance,tolerance/10,tolerance*10)
                inspect(file.name+' fixed '+str(tolerance)+' '+str(ok),repaired)
                dest=out/(file.stem+'_'+str(tolerance)+'.step');repaired.exportStep(str(dest))
                r=Part.Shape();r.read(str(dest));inspect(dest.name+' reread',r)
            except Exception:traceback.print_exc()
fc=list(folder.parent.glob('*.FCStd'))
for file in fc:
    if file.name.startswith('FAILED'):continue
    doc=A.openDocument(str(file))
    for o in doc.Objects:
        if o.TypeId=='App::Link' or not hasattr(o,'Shape') or o.Shape.isNull():continue
        if o.Label.startswith('1A Cam shaft'):
            inspect('native '+o.Name,o.Shape)
            print('NATIVE_TOLERANCES '+str([o.Shape.getTolerance(k) for k in [0,1,2]]),flush=True)
    A.closeDocument(doc.Name)
(out/'step_diagnostic.json').write_text(json.dumps(report,indent=2))
