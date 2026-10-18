"""Cloud CLI adaptation of FreeCAD_AutoMechanism/check_steps.py.

Read all four saved STEP files in a fresh FreeCAD process; do not run on a client.
"""
import json, os, pathlib, sys
if os.environ.get('GITHUB_ACTIONS') != 'true':raise RuntimeError('GitHub-hosted check only.')
import FreeCAD as A
import Part
import numpy as np
TOLERANCE_MM=.01

def samples(shape):
    points=[vertex.Point for vertex in shape.Vertexes]
    for edge in shape.Edges:
        points.extend(edge.discretize(Number=9))
    for face in shape.Faces:
        u0,u1,v0,v1=face.ParameterRange
        for u in [.2,.5,.8]:
            for v in [.2,.5,.8]:
                point=face.valueAt(u0+(u1-u0)*u,v0+(v1-v0)*v)
                if Part.Vertex(point).distToShape(face)[0]<=1e-7:points.append(point)
    unique={tuple(round(x,8) for x in [p.x,p.y,p.z]):p for p in points}
    return list(unique.values())

def directed_deviation(source,target):
    faces=target.Faces
    bounds=np.array([[f.BoundBox.XMin,f.BoundBox.YMin,f.BoundBox.ZMin,f.BoundBox.XMax,f.BoundBox.YMax,f.BoundBox.ZMax] for f in faces])
    points=samples(source);maximum=0.
    for point in points:
        vector=np.array([point.x,point.y,point.z])
        hits=np.flatnonzero(np.all(bounds[:,:3]-TOLERANCE_MM<=vector,axis=1)&np.all(bounds[:,3:]+TOLERANCE_MM>=vector,axis=1))
        if len(hits)==0:raise RuntimeError('No target surface within 0.01 mm sample bounds')
        nearby=Part.makeCompound([faces[int(index)] for index in hits])
        distance=Part.Vertex(point).distToShape(nearby)[0]
        if distance>TOLERANCE_MM:raise RuntimeError('STEP sampled geometric deviation exceeds 0.01 mm: '+str(distance))
        maximum=max(maximum,distance)
    return {'samples':len(points),'maximum_sampled_deviation_mm':maximum}
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
    source=Part.Shape();source.read(str(root/'verification_sources'/(path.stem+'.brep')))
    assert source.isValid() and len(source.Solids)==count
    geometry={'tolerance_mm':TOLERANCE_MM,'method':'bidirectional BRep vertices, nine edge samples, trimmed face UV samples',
              'native_to_step':directed_deviation(source,shape),'step_to_native':directed_deviation(shape,source)}
    row={'file':path.name,'valid':True,'closed':True,'solids':len(shape.Solids),'volume_mm3':shape.Volume,
         'geometry_deviation':geometry,'bounds_mm':[shape.BoundBox.XLength,shape.BoundBox.YLength,shape.BoundBox.ZLength]}
    rows.append(row);print('INDEPENDENT_STEP '+json.dumps(row),flush=True)
report={'status':'PASS','process_id':os.getpid(),'freecad_version':A.Version(),'occ_version':getattr(Part,'OCC_VERSION','unknown'),'files':rows}
(root/'step_independent_check.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
