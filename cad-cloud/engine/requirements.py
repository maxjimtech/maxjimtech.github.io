"""Validate the supported single-start, constant-velocity cam family."""
import math, re

def validate(c):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', c['project']):
        raise ValueError('Project must contain 1-64 ASCII letters, numbers, _ or -.')
    if c['motion'] != 'constant_velocity':
        raise ValueError('V1 supports constant_velocity only.')
    for k in ['ratio','roller_count']:
        if isinstance(c[k],bool) or int(c[k]) != c[k] or not 8 <= c[k] <= 40:
            raise ValueError(k+' must be an integer from 8 to 40.')
    if c['ratio'] != c['roller_count']:
        raise ValueError('V1 single-start model requires ratio = roller_count.')
    for k,v in c.items():
        if k.endswith('_mm') and (not isinstance(v,(float,int)) or not math.isfinite(v) or v <= 0):
            raise ValueError(k+' must be finite and positive.')
    if not 25 < c['cam_root_mm'] < c['cam_od_mm']:
        raise ValueError('Cam root must exceed the fixed 25 mm shaft shoulders and be below cam OD.')
    if c['cam_width_mm'] < 30 or c['shaft_length_mm'] < 71+c['cam_width_mm']+40:
        raise ValueError('Cam width >=30; shaft must leave >=40 mm after the cam.')
    if c['cam_od_mm'] > 75 or c['chamfer_mm'] >= min(2,(c['cam_od_mm']-c['cam_root_mm'])/4):
        raise ValueError('V1 cam OD <=75 and chamfer below 2 mm and one-quarter radial groove depth.')
    pitch=c['roller_pcd_mm']*math.sin(math.pi/c['roller_count'])
    if pitch <= c['roller_od_mm']+1:
        raise ValueError('Adjacent rollers have insufficient circumferential space.')
    if c['roller_pcd_mm']+c['roller_bore_mm']+4 >= c['plate_od_mm']:
        raise ValueError('Roller holes too close to plate outside edge.')
    if not 50 <= c['plate_bore_mm'] <= 75:
        raise ValueError('Fixed auxiliary hole layout requires plate bore between 50 and 75 mm.')
    if c['roller_bore_mm'] < 8 or c['roller_working_width_mm']+2.65 >= c['roller_total_length_mm']:
        raise ValueError('Roller bore >=8; total length must allow stud, shoulder and working band.')
    if c['roller_bore_mm'] >= 11:
        raise ValueError('V1 fixed DIA11 countersink requires follower bore below 11 mm.')
    shoulder=c['roller_total_length_mm']-c['roller_working_width_mm']-2.65
    if abs(shoulder-c['plate_thickness_mm'])>.001:
        raise ValueError('Roller stud length must equal plate thickness: total length = thickness + working width + 2.65.')
    holes=[]
    for name,count,pcd,phase,dia in [('follower',c['roller_count'],c['roller_pcd_mm'],0,c['roller_bore_mm']),('mount',10,85,90,6.5),('tap',10,95,0,4.2),('aux',5,136,9,6),('dowel',2,110,-9,6)]:
        for i in range(count):
            a=math.radians(phase)+2*math.pi*i/count
            holes.append((name,pcd/2*math.cos(a),pcd/2*math.sin(a),dia/2))
    for i,(name,x,y,r) in enumerate(holes):
        if math.hypot(x,y)-r<c['plate_bore_mm']/2+.5 or math.hypot(x,y)+r>c['plate_od_mm']/2-.5:
            raise ValueError('Plate hole violates edge ligament: '+name)
        for other,u,v,s in holes[i+1:]:
            if math.hypot(x-u,y-v)<r+s+.5:
                raise ValueError('Plate holes collide: '+name+' / '+other+'. Change requirements or define a new hole pattern module.')
    if c['plate_back_to_cam_axis_mm'] <= c['plate_thickness_mm']+c['cam_od_mm']/2:
        raise ValueError('Cam stock envelope intersects the plate thickness.')
    work_start=c['plate_thickness_mm']+1.65
    work_end=work_start+c['roller_working_width_mm']
    h=c['plate_back_to_cam_axis_mm']
    if h-work_end<c['cam_root_mm']/2 or h-work_start>c['cam_od_mm']/2:
        raise ValueError('Roller working band must lie within the cam root/OD radial interval. Adjust cam height, working width or diameters.')
    if c['cam_width_mm']>c['roller_pcd_mm']-c['roller_od_mm']-6:
        raise ValueError('Cam width exceeds the available roller orbit for this family.')
    if abs(c['axis_distance_mm']-c['roller_pcd_mm']/2) > c['cam_root_mm']/2+c['roller_od_mm']/2:
        raise ValueError('Cam root and roller orbit cannot meet for this axis spacing.')
    return c
