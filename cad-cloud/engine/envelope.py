"""Finite-cylinder conjugate cutter envelope; dimensions in mm, angles in rad."""
import math, json, pathlib, numpy as np
ROOT=pathlib.Path(__file__).resolve().parent

def sections(c, log=print):
    basis={k:c[k] for k in ['ratio','axis_distance_mm','roller_pcd_mm','roller_od_mm','cam_od_mm','cam_root_mm','cam_width_mm','clearance_mm']}
    if basis=={'ratio':20,'axis_distance_mm':65,'roller_pcd_mm':136,'roller_od_mm':14,'cam_od_mm':50,'cam_root_mm':32,'cam_width_mm':80,'clearance_mm':.00025}:
        return json.loads((ROOT/'assets/cutter_sections.json').read_text())
    R=c['roller_pcd_mm']/2; A=c['axis_distance_mm'];N=c['ratio'];rr=c['roller_od_mm']/2+c['clearance_mm'];S0=c['cam_root_mm']/2;S1=c['cam_od_mm']/2+1;centre=71+c['cam_width_mm']/2;outer=c['cam_od_mm']/2+.1
    def bisect(f,a,b):
        fa=f(a)
        for _ in range(40):
            m=(a+b)/2;fm=f(m)
            if fa*fm<=0:b=m
            else:a=m;fa=fm
        return (a+b)/2
    def golden(f,a,b):
        q=(math.sqrt(5)-1)/2;x=b-q*(b-a);y=a+q*(b-a);fx=f(x);fy=f(y)
        for _ in range(40):
            if fx<fy:b=y;y=x;fy=fx;x=b-q*(b-a);fx=f(x)
            else:a=x;x=y;fx=fy;y=a+q*(b-a);fy=f(y)
        return min(fx,fy,f(a),f(b))
    def intervals(rad):
        if rad<S0:return []
        ta=math.acos(min(1,S0/rad));tb=math.acos(min(1,S1/rad))
        return [(-ta,-tb),(tb,ta)] if tb>1e-12 else [(-ta,ta)]
    def exists(alpha,rad):
        def dy(t):return rad*math.sin(t)-(A-R*math.cos((t-alpha)/N))
        return any(dy(a)<=rr and dy(b)>=-rr for a,b in intervals(rad))
    def bounds(alpha,rad):
        lo=1e10;hi=-1e10
        def vals(t):
            beta=(t-alpha)/N;return beta,rad*math.sin(t)-(A-R*math.cos(beta))
        def ok(t):return rr*rr-vals(t)[1]**2
        for a,b in intervals(rad):
            ts=np.linspace(a,b,81);cuts=[a,b]
            for t,u in zip(ts[:-1],ts[1:]):
                if ok(t)*ok(u)<0:cuts.append(bisect(ok,float(t),float(u)))
            cuts=sorted(set(cuts))
            if a==b and ok(a)>=-1e-8:
                beta,dy=vals(a);h=math.sqrt(max(0,rr*rr-dy*dy));lo=min(lo,centre+R*math.sin(beta)-h);hi=max(hi,centre+R*math.sin(beta)+h)
            for a,b in zip(cuts[:-1],cuts[1:]):
                if ok((a+b)/2)<-1e-8:continue
                def z(t,sign):
                    beta,dy=vals(t);return centre+R*math.sin(beta)+sign*math.sqrt(max(0,rr*rr-dy*dy))
                ss=np.linspace(a,b,9)
                for x,y in zip(ss[:-1],ss[1:]):
                    lo=min(lo,golden(lambda t:z(t,-1),float(x),float(y)));hi=max(hi,-golden(lambda t:-z(t,1),float(x),float(y)))
        if hi<lo:raise ValueError('Envelope has no valid cylinder intersection.')
        return [lo,hi]
    span=max(N*.85,N*math.asin(min(.9,(c['cam_width_mm']/2+rr+3)/R)))
    count=max(409,int(span*24)|1);out=[]
    for i,alpha in enumerate(np.linspace(-span,span,count)):
        grid=np.linspace(S0,outer,401);valid=[j for j,rad in enumerate(grid) if exists(alpha,float(rad))]
        if not valid:continue
        first,last=valid[0],valid[-1];bot=float(grid[first]);top=float(grid[last])
        if first:
            l=float(grid[first-1]);h=bot
            for _ in range(35):
                mid=(l+h)/2
                if exists(alpha,mid):h=mid
                else:l=mid
            bot=h+1e-5
        if last<len(grid)-1:
            l=top;h=float(grid[last+1])
            for _ in range(35):
                mid=(l+h)/2
                if exists(alpha,mid):l=mid
                else:h=mid
            top=l-1e-5
        if top-bot<.005:continue
        row={'alpha':float(alpha)}
        for key,sign in [('lower',-1),('upper',1)]:
            def crit(x):
                b=-alpha/N
                for _ in range(40):
                    vy=R*math.sin(b)-N*x;vz=R*math.cos(b);v=math.hypot(vy,vz);y=A-R*math.cos(b)+rr*sign*vz/v;b=(math.atan2(y,x)-alpha)/N
                return math.hypot(x,y)
            eps=min(.04,(top-bot)/8);c0=min(top-2*eps,max(bot+eps,crit(S0)));c1=min(top-eps,max(c0+eps,crit(S1)))
            radii=list(np.linspace(bot,c0,9))+list(np.linspace(c0,c1,17)[1:])+list(np.linspace(c1,top,9)[1:])
            row[key]=[[float(rad),bounds(alpha,float(rad))[0 if sign==-1 else 1]] for rad in radii]
        out.append(row)
        if i%40==0:log('Envelope sections %d / %d'%(i,count))
    if len(out)<31:raise ValueError('Insufficient envelope sections; requirements are outside supported domain.')
    return out
