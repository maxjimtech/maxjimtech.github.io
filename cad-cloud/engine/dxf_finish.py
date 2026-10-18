"""Add an editable A3 DXF border/title block omitted by TechDraw's SVG template export."""
import pathlib, re, datetime

def add_frame(filename,project,page_name):
    p=pathlib.Path(filename);lines=p.read_text(encoding='utf-8',errors='strict').splitlines()
    if len(lines)%2:raise ValueError('Unpaired DXF group codes.')
    pairs=[(lines[i].strip(),lines[i+1]) for i in range(0,len(lines),2)]
    section=None;end=None
    for i,(k,v) in enumerate(pairs):
        if k=='0' and v.strip()=='SECTION':section=pairs[i+1][1].strip()
        if k=='0' and v.strip()=='ENDSEC' and section=='ENTITIES':end=i;break
    if end is None:raise ValueError('DXF ENTITIES section missing.')
    handles=[int(v.strip(),16) for k,v in pairs if k in ['5','105'] and re.fullmatch('[0-9a-fA-F]+',v.strip())]
    handle=max(handles+[256])+1;entities=[]
    def start(kind):
        nonlocal handle
        entities.extend([('0',kind),('5',format(handle,'X')),('100','AcDbEntity'),('8','0'),('62','8')]);handle+=1
    def line(x1,y1,x2,y2):
        start('LINE');entities.extend([('100','AcDbLine'),('10',str(x1)),('20',str(y1)),('30','0'),('11',str(x2)),('21',str(y2)),('31','0')])
    def text(x,y,s,h=2.5):
        start('TEXT');entities.extend([('100','AcDbText'),('10',str(x)),('20',str(y)),('30','0'),('40',str(h)),('1',s),('7','STANDARD'),('100','AcDbText')])
    from reference_frame import primitives
    frame_lines,frame_texts=primitives(project,page_name)
    for args in frame_lines:line(*args)
    for args in frame_texts:text(*args)
    for i,(k,v) in enumerate(pairs):
        if k=='9' and v.strip()=='$HANDSEED' and pairs[i+1][0]=='5':pairs[i+1]=('5',format(handle+1,'X'))
    pairs[end:end]=entities
    p.write_text('\n'.join(str(x) for pair in pairs for x in pair)+'\n',encoding='utf-8')

def export_page(page,filename,project):
    import TechDraw
    TechDraw.writeDXFPage(page,str(filename));add_frame(filename,project,page.Name)
