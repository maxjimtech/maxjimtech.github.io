import math
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
                curve=Part.BSplineCurve();curve.interpolate(Points=original,Parameters=[float(i) for i in range(len(original))]);edge=curve.toShape();edges.append(edge)
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

class NativeEdgeChamfer:
    def __init__(self,obj,base,indices,size):
        obj.addProperty('App::PropertyLink','Base','Geometry');obj.Base=base
        obj.addProperty('App::PropertyIntegerList','EdgeIndices','Geometry');obj.EdgeIndices=indices
        obj.addProperty('App::PropertyLength','Size','Geometry');obj.Size=size;obj.Proxy=self
    def execute(self,obj):
        signature=(obj.Base.Shape.hashCode(),tuple(obj.EdgeIndices),float(obj.Size))
        if not obj.Shape.isNull() and getattr(self,'_signature',None)==signature:return
        try:
            result=obj.Base.Shape.makeChamfer(float(obj.Size),[obj.Base.Shape.Edges[i-1] for i in obj.EdgeIndices])
            if not result.isValid() or len(result.Solids)!=1:raise ValueError('Invalid native actual-edge chamfer.')
            obj.Shape=result;self._signature=signature
        except Exception as error:
            print('Actual-edge chamfer failed: '+str(error),flush=True);raise
    def dumps(self):return None
    def loads(self,state):pass

class CylindricalSweepCut:
    def __init__(self,obj,base,tools):
        obj.addProperty('App::PropertyLink','Base','Machining');obj.Base=base
        obj.addProperty('App::PropertyLinkList','CutterPoses','Machining');obj.CutterPoses=tools
        obj.addProperty('App::PropertyFloat','FuzzyTolerance','Machining');obj.FuzzyTolerance=1e-7;obj.Proxy=self
    def execute(self,obj):
        signature=(_geometry_key(obj.Base.Shape),_pose_key(obj.CutterPoses),float(obj.FuzzyTolerance))
        if not obj.Shape.isNull() and getattr(self,'_signature',None)==signature:return
        try:
            result=obj.Base.Shape.cut(tuple(t.Shape for t in obj.CutterPoses),float(obj.FuzzyTolerance)).removeSplitter()
            if not result.isValid() or len(result.Solids)!=1 or not result.Solids[0].isClosed():raise ValueError('Invalid finite-cylinder sweep cut.')
            if not 0<result.Volume<obj.Base.Shape.Volume-1e-4:raise ValueError('Finite-cylinder sweep removed no material.')
            obj.Shape=result;self._signature=signature
        except Exception as error:
            print('Finite-cylinder sweep failed: '+str(error),flush=True);raise
    def dumps(self):return getattr(self,'_signature',None)
    def loads(self,state):self._signature=_frozen(state)

class PoseChamferCut:
    """Boolean C cut from exact outer-edge chamfers at individual cutter poses."""
    def __init__(self,obj,base,poses,radius,z0,width,size):
        obj.addProperty('App::PropertyLink','Base','Machining');obj.Base=base
        obj.addProperty('App::PropertyLinkList','CutterPoses','Machining');obj.CutterPoses=poses
        for key,value in [('StockRadius',radius),('CamStart',z0),('CamWidth',width),('Size',size)]:
            obj.addProperty('App::PropertyLength',key,'Machining');setattr(obj,key,value)
        obj.Proxy=self
    def execute(self,obj):
        signature=(_geometry_key(obj.Base.Shape),_pose_key(obj.CutterPoses),float(obj.Size),float(obj.StockRadius),float(obj.CamStart),float(obj.CamWidth))
        if not obj.Shape.isNull() and getattr(self,'_signature',None)==signature:return
        try:
            radius=float(obj.StockRadius);z0=float(obj.CamStart);width=float(obj.CamWidth);size=float(obj.Size)
            removed=[];active=[p for p in obj.CutterPoses if p.Shape.BoundBox.ZMax>=z0-size and p.Shape.BoundBox.ZMin<=z0+width+size]
            for index,pose in enumerate(active):
                axis=pose.Placement.Rotation.multVec(A.Vector(0,0,1));base=pose.Placement.Base
                success=False;last=''
                for margin in [30,.25,0,.4,1]:
                    reference=Part.makeCylinder(radius,width+2*margin,A.Vector(0,0,z0-margin))
                    reference.rotate(A.Vector(),A.Vector(0,0,1),math.degrees(math.atan2(axis.y,axis.x))+90)
                    for seam in [37,73,119]:
                        try:
                            cutter=pose.Shape.copy();cutter.rotate(base,axis,seam)
                            cut=reference.cut(cutter)
                            edges=[]
                            for edge in cut.Edges:
                                if not isinstance(edge.Curve,Part.BSplineCurve):continue
                                points=edge.discretize(Number=5)
                                if max(abs(math.hypot(p.x,p.y)-radius) for p in points)<1e-5 and max(p.z for p in points)-min(p.z for p in points)>.001:edges.append(edge)
                            if not edges:raise ValueError('No cylindrical outer-flank edge at active pose.')
                            chamfer=cut.makeChamfer(size,edges)
                            if not chamfer.isValid():raise ValueError('Invalid individual pose chamfer.')
                            material=cut.cut(chamfer)
                            if material.isNull() or not material.isValid() or material.Volume<=1e-8:raise ValueError('Individual chamfer removes no valid material.')
                            removed.append(material);success=True;break
                        except Exception as error:last=str(error)
                    if success:
                        if margin!=30:print('Pose bevel reference '+str(index)+' margin_mm='+str(margin),flush=True)
                        break
                if not success:raise ValueError('C0.5 pose '+str(index)+' failed: '+last)
                if index%20==0:print('Actual-edge Boolean C0.5 pose '+str(index+1)+'/'+str(len(active)),flush=True)
            result=obj.Base.Shape.cut(tuple(removed),1e-7).removeSplitter()
            if not result.isValid() or len(result.Solids)!=1 or not result.Solids[0].isClosed():raise ValueError('Invalid whole cam after pose bevel Boolean.')
            if not 0<result.Volume<obj.Base.Shape.Volume-1e-6:raise ValueError('Pose bevel removes no stock.')
            obj.Shape=result;self._signature=signature
        except Exception as error:
            print('Pose bevel failed: '+str(error),flush=True);raise
    def dumps(self):return getattr(self,'_signature',None)
    def loads(self,state):self._signature=_frozen(state)


import hashlib

def _frozen(value):
    return tuple(_frozen(v) for v in value) if isinstance(value,(tuple,list)) else value

def _geometry_key(shape):
    data=shape.exportBrepToString()
    return hashlib.sha256(data.encode() if isinstance(data,str) else data).hexdigest()

def _pose_key(poses):
    return tuple((round(float(p.Radius),12),round(float(p.Height),12),tuple(round(v,12) for v in p.Placement.toMatrix().A)) for p in poses)
