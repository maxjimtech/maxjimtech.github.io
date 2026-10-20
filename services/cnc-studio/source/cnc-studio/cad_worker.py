"""CNC-specific feature extraction; shared STEP acceptance stays in cad_tools."""
import FreeCAD as App
import Part
import sys, json, math
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'cad_tools'))
from step_audit import audit_step_shape


def analyze(path):
    audit = audit_step_shape(path)
    if not (audit['valid'] and audit['solid_count'] == 1 and audit['closed_solids'] and audit['standalone_faces'] == 0):
        raise ValueError('僅支援單一有效封閉實體，請先拆分組立或修復 STEP。')
    shape = Part.read(str(path))
    b = shape.BoundBox
    shape.translate(App.Vector(-b.XMin, -b.YMin, -b.ZMax))
    b = shape.BoundBox
    sx, sy, sz = b.XLength, b.YLength, b.ZLength
    features, removed = [], []
    # Bottom planar faces are only candidates. Reconstruct the entire target
    # from stock minus those cavities before permitting an automatic NC draft.
    for i, face in enumerate(shape.Faces):
        bb = face.BoundBox
        if type(face.Surface).__name__ == 'Plane' and bb.ZLength < 1e-5 and -sz+1e-5 < bb.ZMin < -1e-5:
            if abs(face.Area - bb.XLength*bb.YLength) < 1e-4 and bb.XLength > 0 and bb.YLength > 0 and len(face.Edges) == 4:
                cavity = Part.makeBox(bb.XLength, bb.YLength, -bb.ZMin, App.Vector(bb.XMin, bb.YMin, bb.ZMin))
                if shape.common(cavity).Volume < 1e-5:
                    features.append({'kind':'pocket','id':f'F{i+1}', 'x':bb.XMin,'y':bb.YMin,'w':bb.XLength,'h':bb.YLength,'depth':-bb.ZMin})
                    removed.append(cavity)
    for i, face in enumerate(shape.Faces):
        surface, bb = face.Surface, face.BoundBox
        if type(surface).__name__ != 'Cylinder' or abs(abs(surface.Axis.z)-1) > 1e-6:
            continue
        radius = surface.Radius
        x, y = surface.Center.x, surface.Center.y
        if abs(bb.ZMax) > 1e-5 or abs(bb.ZMin+sz) > 1e-5:
            continue  # no blind drills or stepped bores in v1
        if abs(face.Area - 2*math.pi*radius*sz) > 1e-3:
            continue
        cavity = Part.makeCylinder(radius, sz, App.Vector(x,y,-sz))
        if shape.common(cavity).Volume < 1e-5 and x-radius > 0 and y-radius > 0 and x+radius < sx and y+radius < sy:
            features.append({'kind':'drill','id':f'F{i+1}','x':x,'y':y,'diameter':2*radius,'depth':sz})
            removed.append(cavity)
    expected = Part.makeBox(sx, sy, sz, App.Vector(0,0,-sz))
    for cavity in removed:
        expected = expected.cut(cavity)
    difference = expected.cut(shape).Volume + shape.cut(expected).Volume
    supported = difference < max(1e-4, shape.Volume*1e-7)
    if len(features) > 60:
        supported = False
    vertices, triangles = shape.tessellate(max(.12, max(sx,sy,sz)/400))
    if len(triangles) > 100000:
        raise ValueError('模型網格超過本版 100,000 三角形上限，請拆分工件或簡化細節。')
    return {'audit':audit,'size':[sx,sy,sz], 'vertices':[[p.x,p.y,p.z] for p in vertices],
            'triangles':[list(t) for t in triangles], 'features':features,
            'supported':supported,'difference_mm3':difference,
            'frame':'G54: finished bounding-box Xmin/Ymin, finished top Z0; source translation only',
            'limitations':[] if supported else ['外形不屬於完整可重建的矩形塊／頂開矩形口袋／垂直通孔。可預覽，禁止自動 NC。']}


def demo(path):
    shape = Part.makeBox(100,70,20)
    shape = shape.cut(Part.makeBox(46,30,8,App.Vector(27,20,12)))
    for x,y in [(12,12),(88,12),(12,58),(88,58)]:
        shape = shape.cut(Part.makeCylinder(6,20,App.Vector(x,y,0)))
    shape.exportStep(str(path))


if __name__ == '__main__':
    try:
        if sys.argv[1] == 'demo':
            demo(Path(sys.argv[2]))
        else:
            result = analyze(Path(sys.argv[2]))
            Path(sys.argv[3]).write_text(json.dumps(result,ensure_ascii=False,allow_nan=False),encoding='utf-8')
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
