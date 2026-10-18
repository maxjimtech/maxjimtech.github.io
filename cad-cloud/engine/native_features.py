"""Small persistent FreeCAD features. Load this module before opening FCStd."""
import FreeCAD as A, Part

class RobustCut:
    """Editable linked boolean with an explicit, recorded OCC fuzzy tolerance."""
    def __init__(self,obj,base,tool,tolerance):
        obj.addProperty('App::PropertyLink','Base','Boolean');obj.Base=base
        obj.addProperty('App::PropertyLink','Tool','Boolean');obj.Tool=tool
        obj.addProperty('App::PropertyFloat','FuzzyTolerance','Boolean','OCC coincidence tolerance in mm')
        obj.FuzzyTolerance=tolerance;obj.Proxy=self
    def execute(self,obj):
        signature=(obj.Base.Shape.hashCode(),obj.Tool.Shape.hashCode(),obj.FuzzyTolerance)
        if getattr(self,'_signature',None)==signature and not obj.Shape.isNull():return
        obj.Shape=obj.Base.Shape.cut(obj.Tool.Shape,float(obj.FuzzyTolerance)).removeSplitter()
        self._signature=signature
    def dumps(self):return None
    def loads(self,state):pass

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

class SplineSection:
    """Editable radial envelope wire with eight corresponding edges per section."""
    def __init__(self,obj,points):
        obj.addProperty('App::PropertyVectorList','Points','Geometry','Original envelope sample points')
        obj.addProperty('App::PropertyFloat','MaxPolylineDeviation','Geometry','Sampled curve-to-source-polyline distance, mm')
        obj.Points=points;obj.Proxy=self
    def execute(self,obj):
        pts=list(obj.Points);signature=tuple((p.x,p.y,p.z) for p in pts)
        if not obj.Shape.isNull() and getattr(self,'_points',None)==signature:return
        n=len(pts)//2
        if len(pts)!=2*n or n<9:raise ValueError('Envelope section requires paired radial samples.')
        lower=pts[:n];upper=pts[n:];ends=[0,n//4,n-1-n//4,n-1]
        edges=[];maximum=0.
        for side_index,side in enumerate([lower,upper]):
            if side_index:edges.append(Part.makeLine(lower[-1],upper[0]))
            for first,last in zip(ends[:-1],ends[1:]):
                original=side[first:last+1]
                curve=Part.BSplineCurve();curve.interpolate(original);edge=curve.toShape();edges.append(edge)
                for p in edge.discretize(Number=65):
                    best=float('inf')
                    for a,b in zip(original[:-1],original[1:]):
                        d=b-a;den=d.dot(d);t=max(0.,min(1.,(p-a).dot(d)/den)) if den else 0.
                        best=min(best,(p-(a+d*t)).Length)
                    maximum=max(maximum,best)
        edges.append(Part.makeLine(upper[-1],lower[0]));wire=Part.Wire(edges)
        if not wire.isClosed() or not wire.isValid():raise ValueError('Invalid fitted envelope section.')
        if maximum>.25:
            print('Spline section fit rejected '+obj.Name+' deviation_mm='+str(maximum),flush=True)
            raise ValueError('Radial curve fit deviates more than 0.25 mm from input polyline: '+str(maximum))
        obj.Shape=wire;obj.MaxPolylineDeviation=maximum;self._points=signature
    def dumps(self):return getattr(self,'_points',None)
    def loads(self,state):self._points=tuple(tuple(p) for p in state) if state is not None else None

class RuledSectionSolid:
    """Linked shell/cap construction preserving known section-edge correspondence."""
    def __init__(self,obj,sections):
        obj.addProperty('App::PropertyLinkList','Sections','Geometry')
        obj.Sections=sections;obj.Proxy=self
    def execute(self,obj):
        signature=tuple(tuple((p.x,p.y,p.z) for p in section.Points) for section in obj.Sections)
        if not obj.Shape.isNull() and getattr(self,'_signature',None)==signature:return
        try:
            wires=[section.Shape for section in obj.Sections]
            side=Part.makeShellFromWires(wires)
            caps=[Part.Face(wires[0]),Part.Face(wires[-1])]
            shell=Part.makeShell(side.Faces+caps)
            if not shell.isClosed():raise ValueError('Section solid shell is not closed.')
            solid=Part.makeSolid(shell)
            if solid.Volume<0:solid.reverse()
            if not solid.isValid() or len(solid.Solids)!=1:raise ValueError('Section solid is invalid.')
            obj.Shape=solid;self._signature=signature
        except Exception as error:
            print('Section solid failed '+obj.Name+': '+str(error),flush=True);raise
    def dumps(self):return getattr(self,'_signature',None)
    def loads(self,state):self._signature=tuple(tuple(tuple(p) for p in section) for section in state) if state is not None else None
