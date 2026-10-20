"""Deterministic, bounded 2.5D rough CAM. AI never emits motion blocks."""
import json, math, copy
from pathlib import Path
CATALOG = json.loads((Path(__file__).parent/'catalog.json').read_text(encoding='utf-8'))


def number(value, name, lo, hi):
    if type(value) not in (int,float) or not math.isfinite(value) or not lo <= value <= hi:
        raise ValueError(f'{name} 必須介於 {lo} 與 {hi}')
    return float(value)


def settings(model, supplied):
    c = copy.deepcopy(supplied)
    for key, group in [('machine','machines'),('material','materials'),('tool','tools'),('fixture','fixtures')]:
        if c.get(key) not in {v['id'] for v in CATALOG[group]}:
            raise ValueError(f'未知的 {key}')
    sx,sy,sz = model['size']
    for name,lo,hi in [('stock_x',sx,2000),('stock_y',sy,2000),('stock_z',sz,1000),
                        ('safe_z',2,200),('stepdown',.1,3),('stepover',.1,.65),('feed_scale',.1,1),('breakthrough',0,5)]:
        c[name] = number(c.get(name),name,lo,hi)
    boxes = c.get('fixture_boxes',[])
    if not isinstance(boxes,list) or len(boxes)>30:
        raise ValueError('治具包絡盒數量不正確')
    for box in boxes:
        if not isinstance(box,list) or len(box)!=6:
            raise ValueError('包絡盒格式：[xmin,ymin,zmin,xmax,ymax,zmax]')
        for v in box: number(v,'fixture coordinate',-3000,3000)
        if any(box[i]>=box[i+3] for i in range(3)): raise ValueError('包絡盒上下限不正確')
    # Optional machine capability override is explicit and constrained.
    m = next(copy.deepcopy(v) for v in CATALOG['machines'] if v['id']==c['machine'])
    override = c.get('machine_limits',{})
    if not isinstance(override,dict): raise ValueError('母機能力格式錯誤')
    for key in ['rpm','feed','rapid']:
        if key in override: m[key] = number(override[key],key,100,60000)
    if 'travel' in override:
        if not isinstance(override['travel'],list) or len(override['travel'])!=3: raise ValueError('行程需三個值')
        m['travel'] = [number(v,'travel',10,5000) for v in override['travel']]
    c['resolved_machine'] = m
    return c


def default_settings(model):
    x,y,z = model['size']
    return {'machine':'vmc400','material':'al6061','tool':'em6','fixture':'vise',
            'stock_x':x,'stock_y':y,'stock_z':z+1,'safe_z':10,'stepdown':1,'stepover':.4,
            'feed_scale':1,'breakthrough':4,'fixture_boxes':[], 'machine_limits':{}}


def segment_box(a,b,box,radius,low,high):
    # Swept vertical cylindrical envelope, conservative rectangular XY bounds.
    lo = [box[0]-radius,box[1]-radius,box[2]-high]
    hi = [box[3]+radius,box[4]+radius,box[5]-low]
    t0,t1=0.,1.
    for i in range(3):
        d=b[i]-a[i]
        if abs(d)<1e-12:
            if not lo[i]<=a[i]<=hi[i]: return False
        else:
            u,v=(lo[i]-a[i])/d,(hi[i]-a[i])/d
            t0,t1=max(t0,min(u,v)),min(t1,max(u,v))
            if t0>t1: return False
    return True


def build_plan(model, supplied, strategy='raster'):
    c=settings(model,supplied)
    machine=c['resolved_machine']
    material=next(v for v in CATALOG['materials'] if v['id']==c['material'])
    tool=next(v for v in CATALOG['tools'] if v['id']==c['tool'])
    if tool['kind']!='endmill': raise ValueError('口袋與面銑需選擇中心切削平底銑刀')
    x,y,z=model['size']; allowance=c['stock_z']-z; safe=c['safe_z']
    blockers=[]; warnings=[]; tasks=[]; ops=[]; moves=[]
    if not model['supported']: blockers.extend(model['limitations'])
    if abs(c['stock_x']-x)>1e-4 or abs(c['stock_y']-y)>1e-4:
        blockers.append('第一版未產生外輪廓／底面加工；請使用已預加工至成品 XY 尺寸的素材。')
    if safe <= allowance+1: blockers.append('安全 Z 必須比素材頂面至少高 1 mm。')
    if not c['fixture_boxes']: warnings.append('未提供治具包絡盒，治具碰撞未驗證。')
    warnings += ['刀路為粗加工草稿；矩形口袋內角保留刀具半徑殘料，未含清角、精加工與公差驗證。',
                 '3D／2D 為刀路與刀具包絡播放，未模擬切屑、材料移除、機台本體或換刀動作。',
                 'FANUC 母機專用換刀、行程原點、G54 與 H 補正仍需現場確認；不可直接上機。']
    tasks=[{'title':'STEP 幾何與裝夾方向檢查','detail':f'單實體，固定 +Z 刀軸；{len(model["features"])} 個候選特徵'},
           {'title':'素材與裝夾','detail':f'{c["stock_x"]:g} × {c["stock_y"]:g} × {c["stock_z"]:g} mm；完成面左下角 G54，頂面 Z0'}]
    position=[0.,0.,safe]
    def parameters(t):
        rpm=min(machine['rpm'],material['vc']*1000/(math.pi*t['diameter']))
        feed=min(machine['feed'],rpm*t['flutes']*material['fz'])*c['feed_scale']
        return round(rpm),round(feed,1)
    def add(mode,point,t,feed,op):
        nonlocal position
        point=[round(float(v),4) for v in point]
        if point==position: return
        if len(moves)>60000: raise ValueError('刀路過多；請增加步距或縮小素材')
        moves.append({'a':position[:],'b':point,'mode':mode,'tool':t['id'],'feed':feed,'op':op})
        position=point
    def begin(title,t):
        rpm,feed=parameters(t)
        op=len(ops); ops.append({'id':op,'title':title,'tool':t['id'],'rpm':rpm,'feed':feed,'start':len(moves)})
        tasks.append({'title':title,'detail':f'T{t["number"]} Ø{t["diameter"]:g} · {rpm} rpm · {feed:g} mm/min'})
        return op,feed
    def retract(t,feed,op): add('G0',[position[0],position[1],safe],t,feed,op)
    if model['supported']:
        dz=min(c['stepdown'],material['stepdown']); radius=tool['diameter']/2
        if allowance>1e-6:
            op,feed=begin('素材頂面分層面銑',tool)
            start=-radius-1
            end=x+radius+1
            rows=max(1,math.ceil(y/(tool['diameter']*c['stepover'])))
            for layer in range(1,math.ceil(allowance/dz)+1):
                level=max(0,allowance-layer*dz)
                for row in range(rows+1):
                    yy=y*row/rows
                    a,b=(start,end) if row%2==0 else (end,start)
                    retract(tool,feed,op); add('G0',[a,yy,safe],tool,feed,op)
                    add('G1',[a,yy,level],tool,feed*.25,op); add('G1',[b,yy,level],tool,feed,op)
            retract(tool,feed,op)
        for feature in model['features']:
            depth=feature['depth']
            if feature['kind']=='pocket':
                if tool['diameter']>=min(feature['w'],feature['h']):
                    blockers.append(f'{feature["id"]} 口袋小於刀具可用寬度'); continue
                if depth+allowance>=tool['flute_length']:
                    blockers.append(f'{feature["id"]} 超出有效刃長'); continue
                op,feed=begin(f'{feature["id"]} 矩形口袋粗銑',tool)
                xmin=feature['x']+radius; xmax=feature['x']+feature['w']-radius
                ymin=feature['y']+radius; ymax=feature['y']+feature['h']-radius
                for layer in range(1,math.ceil(depth/dz)+1):
                    level=-min(depth,layer*dz)
                    retract(tool,feed,op); add('G0',[xmin,ymin,safe],tool,feed,op)
                    # center-cutting tool only; conservative plunge feed.
                    add('G1',[xmin,ymin,level+min(dz,.5)],tool,feed*.2,op)
                    add('G1',[xmin,ymin,level],tool,feed*.15,op)
                    if strategy=='contour':
                        left,right,bottom,top=xmin,xmax,ymin,ymax
                        while left<=right+1e-6 and bottom<=top+1e-6:
                            for xx,yy in [(left,bottom),(right,bottom),(right,top),(left,top),(left,bottom)]:
                                add('G1',[xx,yy,level],tool,feed,op)
                            left+=tool['diameter']*c['stepover']; right-=tool['diameter']*c['stepover']
                            bottom+=tool['diameter']*c['stepover']; top-=tool['diameter']*c['stepover']
                        # Finish central region with raster to avoid an uncut center strip.
                    rows=max(1,math.ceil((ymax-ymin)/(tool['diameter']*c['stepover'])))
                    for row in range(rows+1):
                        yy=ymin+(ymax-ymin)*row/rows
                        a,b=(xmin,xmax) if row%2==0 else (xmax,xmin)
                        add('G1',[a,yy,level],tool,feed,op); add('G1',[b,yy,level],tool,feed,op)
                    # Full boundary pass clears raster end strips.
                    for xx,yy in [(xmin,ymax),(xmin,ymin),(xmax,ymin),(xmax,ymax),(xmin,ymax)]:
                        add('G1',[xx,yy,level],tool,feed,op)
                    retract(tool,feed,op)
            elif feature['kind']=='drill':
                drill=next((t for t in CATALOG['tools'] if t['kind']=='drill' and abs(t['diameter']-feature['diameter'])<.01),None)
                if not drill: blockers.append(f'{feature["id"]} 缺少 Ø{feature["diameter"]:g} 配套鑽頭'); continue
                if c['breakthrough'] < drill['diameter']/2/math.tan(math.radians(59)):
                    blockers.append(f'{feature["id"]} 鑽尖延伸不足以讓 118 度鑽尖完整通孔'); continue
                if depth+allowance+c['breakthrough']>=drill['flute_length']:
                    blockers.append(f'{feature["id"]} 鑽頭刃長不足'); continue
                op,feed=begin(f'{feature["id"]} 通孔分層啄鑽',drill)
                retract(drill,feed,op); add('G0',[feature['x'],feature['y'],safe],drill,feed,op)
                bottom=-depth-c['breakthrough']; level=0
                while level>bottom:
                    level=max(bottom,level-min(2,drill['diameter']*.3))
                    add('G1',[feature['x'],feature['y'],level],drill,feed*.3,op)
                    retract(drill,feed,op)
        if not moves: blockers.append('此素材不需可支援的加工，未產生刀路。')
    collisions=[]
    tools={t['id']:t for t in CATALOG['tools']}
    time_min=0; cut_mm=0
    for index,move in enumerate(moves):
        t=tools[move['tool']]; a,b=move['a'],move['b']
        length=math.dist(a,b); time_min+=length/(machine['rapid'] if move['mode']=='G0' else move['feed'])
        if move['mode']=='G1': cut_mm+=length
        for box_index,box in enumerate(c['fixture_boxes']):
            if segment_box(a,b,box,t['diameter']/2,0,t['length']) or segment_box(a,b,box,t['holder_diameter']/2,t['length'],t['length']+t['holder_length']):
                collisions.append({'move':index,'box':box_index})
                if len(collisions)>100: break
    if collisions: blockers.append('刀具／刀柄掃掠包絡與治具盒相交，禁止輸出。')
    if moves:
        points=[p for move in moves for p in (move['a'],move['b'])]
        extents=[max(p[i] for p in points)-min(p[i] for p in points) for i in range(3)]
        if any(extents[i]+(2*max(tools[m['tool']]['diameter']/2 for m in moves) if i<2 else max(tools[m['tool']]['length']+tools[m['tool']]['holder_length'] for m in moves))>machine['travel'][i] for i in range(3)):
            blockers.append('刀具掃掠範圍超出母機行程範本；尚未核對實際機械座標極限。')
    return {'settings':c,'tasks':tasks,'operations':ops,'moves':moves,'strategy':strategy,
            'blockers':list(dict.fromkeys(blockers)),'warnings':warnings,'collisions':collisions,
            'minutes':round(time_min,2),'cut_mm':round(cut_mm,1),'status':'BLOCKED' if blockers else 'DRAFT',
            'scope':'Top facing, rectangular pocket roughing and matched vertical through drills only. No production release.'}


def gcode(plan):
    if plan['blockers'] or not plan['moves']: raise ValueError('目前計畫有阻擋項目，不能輸出 NC')
    tools={t['id']:t for t in CATALOG['tools']}
    safe=plan['settings']['safe_z']
    lines=['%','O1001 (CNC STUDIO - FANUC STYLE DRAFT)',
           '(UNVERIFIED MACHINE POST - ROUGHING ONLY)',
           '(G54 X/Y FINISHED BBOX MIN - Z FINISHED TOP)',
           '(VERIFY G54 H OFFSETS FIXTURE AND TOOLCHANGE)',
           'G21 G17 G90 G94 G40 G80', 'G54']
    lines[2:2]=[f'(PLAN {plan.get("id","LOCAL")})',
                f'(MATERIAL {plan["settings"]["material"]} - STARTING VALUES ONLY)',
                '(POCKET CORNERS RETAIN CUTTER RADIUS STOCK)']
    active=None
    for op in plan['operations']:
        if not any(m['op']==op['id'] for m in plan['moves']): continue
        t=tools[op['tool']]
        if active!=t['id']:
            if active is not None: lines += [f'G00 Z{safe:.4f}','M09','M05']
            lines += ['M00 (MANUALLY VERIFY SAFE TOOLCHANGE POSITION)',
                      f'T{t["number"]:02d} M06', f'G00 G43 H{t["number"]:02d} Z{safe:.4f}',
                      f'S{op["rpm"]} M03','M08']
            active=t['id']
        lines += [f'(OP {op["id"]+1})']
        for move in plan['moves']:
            if move['op']!=op['id']: continue
            xx,yy,zz=move['b']
            line=f'{move["mode"]} X{xx:.4f} Y{yy:.4f} Z{zz:.4f}'
            if move['mode']=='G1': line+=f' F{move["feed"]:.1f}'
            lines.append(line)
    lines += [f'G00 Z{safe:.4f}','M09','M05','M30','%']
    return '\n'.join(lines)+'\n'
