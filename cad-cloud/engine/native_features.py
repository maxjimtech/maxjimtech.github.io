"""Small persistent FreeCAD features. Load this module before opening FCStd."""
import FreeCAD as A, Part

class Polygon:
    def __init__(self,obj,points):
        obj.addProperty('App::PropertyVectorList','Points','Geometry','Editable section vertices')
        obj.Points=points;obj.Proxy=self
    def execute(self,obj):
        pts=list(obj.Points)
        # Preserve topology when restoring unchanged section data.
        if not obj.Shape.isNull():
            vv=obj.Shape.Vertexes
            if len(vv)==len(pts) and all((v.Point-p).Length<1e-10 for v,p in zip(vv,pts)):
                return
        obj.Shape=Part.makePolygon(pts+[pts[0]])
    def dumps(self):return None
    def loads(self,state):pass

class RevolvedRing:
    def __init__(self,obj,points):
        obj.addProperty('App::PropertyVectorList','ProfilePoints','Geometry')
        obj.ProfilePoints=points;obj.Proxy=self
    def execute(self,obj):
        pts=list(obj.ProfilePoints);obj.Shape=Part.Face(Part.makePolygon(pts+[pts[0]])).revolve(A.Vector(),A.Vector(0,0,1),360)
    def dumps(self):return None
    def loads(self,state):pass

class AssemblyShape:
    def __init__(self,obj,occurrences):
        obj.addProperty('App::PropertyLinkList','Occurrences','Assembly')
        obj.Occurrences=occurrences;obj.Proxy=self
    def execute(self,obj):
        signature=[]
        for o in obj.Occurrences:
            source=o.LinkedObject if o.TypeId=='App::Link' else o
            matrix=o.LinkPlacement.toMatrix() if o.TypeId=='App::Link' else A.Placement().toMatrix()
            signature.append((source.Shape.hashCode(),tuple(matrix.A)))
        signature=tuple(signature)
        if getattr(self,'_signature',None)==signature and not obj.Shape.isNull():
            return
        shapes=[]
        for o in obj.Occurrences:
            if o.TypeId=='App::Link':
                s=o.LinkedObject.Shape.copy();s.Placement=o.LinkPlacement.multiply(s.Placement)
            else:s=o.Shape.copy()
            shapes.append(s)
        obj.Shape=Part.makeCompound(shapes)
        self._signature=signature
    def dumps(self):return None
    def loads(self,state):pass
