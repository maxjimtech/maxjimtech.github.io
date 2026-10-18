"""Static review preview from exported DXF entities; uses the recorded native dimension values."""
import pathlib,json,math,sys,os
from PIL import Image,ImageDraw,ImageFont
ROOT=pathlib.Path(__file__).resolve().parent
out=pathlib.Path(sys.argv[1]).resolve() if len(sys.argv)>1 else ROOT/'output/RD065_FreeCAD_R1_Final'
values={r['dimension']:r['measured_mm'] for r in json.loads((out/'dimension_ledger.json').read_text())}
S=5;PAD=30
fontpath=os.environ.get('CAD_PREVIEW_FONT','C:/Windows/Fonts/msjh.ttc')
def records(p):
    ls=p.read_text(encoding='utf-8').splitlines();pairs=[(ls[i].strip(),ls[i+1]) for i in range(0,len(ls),2)];rows=[];cur=None
    for k,v in pairs:
        if k=='0':
            if cur:rows.append(cur)
            cur=[v.strip(),[]]
        elif cur:cur[1].append((k,v))
    if cur:rows.append(cur)
    return rows
def one(row,code,default='0'):return next((v for k,v in row[1] if k==str(code)),default)
def xy(row,a=10):return float(one(row,a)),float(one(row,a+10))
def pixel(p):return PAD+p[0]*S,PAD+(297-p[1])*S
def render(p):
    rows=records(p);blocks={};ents=[];sec=None;block=None
    for r in rows:
        if r[0]=='SECTION':sec=one(r,2)
        elif r[0]=='ENDSEC':sec=None
        elif sec=='BLOCKS':
            if r[0]=='BLOCK':block=one(r,2);blocks[block]=[]
            elif r[0]=='ENDBLK':block=None
            elif block:blocks[block].append(r)
        elif sec=='ENTITIES':ents.append(r)
    assert any(r[0]=='TEXT' and 'V1 REVIEW' in one(r,1) for r in ents),'Final A3 frame missing'
    im=Image.new('RGB',(420*S+2*PAD,297*S+2*PAD),'white');dr=ImageDraw.Draw(im)
    def draw(r,dim=None):
        typ=r[0];col=(20,30,40)
        if typ=='LINE':dr.line([pixel(xy(r)),pixel(xy(r,11))],fill=col,width=1)
        elif typ in ['CIRCLE','ARC']:
            x,y=xy(r);rad=float(one(r,40));a=float(one(r,50)) if typ=='ARC' else 0;b=float(one(r,51)) if typ=='ARC' else 360
            if b<a:b+=360
            pts=[pixel((x+rad*math.cos(math.radians(a+(b-a)*i/80)),y+rad*math.sin(math.radians(a+(b-a)*i/80)))) for i in range(81)];dr.line(pts,fill=col,width=1)
        elif typ=='ELLIPSE':
            x,y=xy(r);mx,my=xy(r,11);q=float(one(r,40));a=float(one(r,41));b=float(one(r,42,str(2*math.pi)));pts=[]
            for i in range(81):
                t=a+(b-a)*i/80;pts.append(pixel((x+mx*math.cos(t)-my*q*math.sin(t),y+my*math.cos(t)+mx*q*math.sin(t))))
            dr.line(pts,fill=col,width=1)
        elif typ=='LWPOLYLINE':
            pts=[];x=None
            for k,v in r[1]:
                if k=='10':x=float(v)
                elif k=='20' and x is not None:pts.append(pixel((x,float(v))))
            if int(one(r,70))&1 and pts:pts.append(pts[0])
            if len(pts)>1:dr.line(pts,fill=col,width=1)
        elif typ=='SOLID':
            pts=[pixel(xy(r,k)) for k in [10,11,12,13]];dr.polygon(pts,fill=col)
        elif typ in ['TEXT','MTEXT']:
            text=one(r,1,'').strip()
            if not text and dim:
                name=dim.lstrip('*');v=values.get(name)
                if v is not None:text=('Ø' if 'Diameter' in name or name in ['CamNominalOD','RollerOutsideDiameter'] else '')+('%g'%v)
            if not text:return
            h=max(2,float(one(r,40,'2.5')));f=ImageFont.truetype(fontpath,max(10,round(h*S)))
            dr.text(pixel(xy(r)),text.replace('%%c','Ø'),font=f,fill=col,anchor='ls')
        elif typ=='DIMENSION':
            name=one(r,2)
            for b in blocks.get(name,[]):draw(b,name)
    for r in ents:draw(r)
    d=out/'Preview';d.mkdir(exist_ok=True);im.save(d/(p.stem+'.png'));print('PREVIEW',p.name,flush=True)
for p in (out/'DXF').glob('*.dxf'):render(p)
