"""Cloud CLI adaptation of FreeCAD_AutoMechanism/check_steps.py.

Read all four saved STEP files in a fresh FreeCAD process; do not run on a client.
"""
import json, os, pathlib, sys
if os.environ.get('GITHUB_ACTIONS') != 'true':raise RuntimeError('GitHub-hosted check only.')
import FreeCAD as A
import Part
root=pathlib.Path(sys.argv[1]).resolve()
config=json.loads((root/'requirements.json').read_text(encoding='utf-8'))
validation=json.loads((root/'validation.json').read_text(encoding='utf-8'))
expected={row['file']:row for row in validation['step_reopen']}
names={'CamShaft.step','RollerPlate.step','Roller.step','Assembly.step'}
assert set(expected)==names
assert {p.name for p in (root/'STEP').glob('*.step')}==names
rows=[]
for path in sorted((root/'STEP').glob('*.step')):
    shape=Part.Shape();shape.read(str(path))
    count=config['roller_count']+2 if path.stem=='Assembly' else 1
    assert shape.isValid() and len(shape.Solids)==count and all(s.isClosed() for s in shape.Solids), path.name
    original=expected[path.name]['source_volume_mm3']
    assert abs(shape.Volume-original)<=max(.001,abs(original)*1e-5), path.name
    row={'file':path.name,'valid':True,'closed':True,'solids':len(shape.Solids),'volume_mm3':shape.Volume,
         'bounds_mm':[shape.BoundBox.XLength,shape.BoundBox.YLength,shape.BoundBox.ZLength]}
    rows.append(row);print('INDEPENDENT_STEP '+json.dumps(row),flush=True)
report={'status':'PASS','process_id':os.getpid(),'freecad_version':A.Version(),'occ_version':getattr(Part,'OCC_VERSION','unknown'),'files':rows}
(root/'step_independent_check.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
