"""A3 reference-style frame shared by native SVG and editable DXF."""
import datetime, pathlib, html
TITLES={'AssemblyDrawing':'機構組合圖','CamDrawing':'凸輪軸','PlateDrawing':'滾子盤','RollerDrawing':'滾子外型'}
def primitives(project,page):
    lines=[(10,10,410,10),(410,10,410,287),(410,287,10,287),(10,287,10,10)]
    lines += [(x,10,x,46) for x in [225,250,275,320,403]]
    lines += [(225,46,410,46),(275,38,320,38),(275,30,410,30),(275,22,320,22),(275,16,320,16),(320,20,410,20),(250,20,275,20),(286,10,286,16),(305,10,305,16),(334,10,334,30)]
    texts=[(228,40,'公差／表面要求',2),(228,34,'待確認',2.5),(228,22,'V1 REVIEW',2.4),(253,40,'配合／幾何要求',2),(253,33,'待確認',2.5),(253,14,'第三角法',2.4),(276,40,'繪圖',2.3),(276,32,'設計',2.3),(276,24,'審核',2.3),(276,18,'核准',2.3),(276,12,'比例',2),(288,12,'依視圖',2),(306,12,'材料待定',2),(342,39,'Gem jack',4),(323,33,'圖框參考 RD065 原圖',2.3),(322,24,'圖號',2.3),(335,24,project,2.3),(322,13,'圖名',2.3),(335,13,TITLES.get(page,page),3),(404,24,'R1',2),(404,13,str(list(TITLES).index(page)+1)+'/4',2),(15,14,datetime.date.today().isoformat()+' / mm / REVIEW',2.4)]
    return lines,texts
def write_svg(path,project,page):
    lines,texts=primitives(project,page)
    s=['<svg xmlns="http://www.w3.org/2000/svg" xmlns:freecad="http://www.freecadweb.org/wiki/index.php?title=Svg_Namespace" width="420mm" height="297mm" viewBox="0 0 420 297">','<g fill="none" stroke="black" stroke-width="0.18">']
    s += [f'<line x1="{a}" y1="{297-b}" x2="{c}" y2="{297-d}" />' for a,b,c,d in lines];s+=['</g>','<g fill="black" font-family="Microsoft JhengHei,Arial">']
    s += [f'<text x="{x}" y="{297-y}" font-size="{h}" freecad:editable="Field{i}">{html.escape(t)}</text>' for i,(x,y,t,h) in enumerate(texts)]
    s+=['</g></svg>'];pathlib.Path(path).write_text('\n'.join(s),encoding='utf-8')
