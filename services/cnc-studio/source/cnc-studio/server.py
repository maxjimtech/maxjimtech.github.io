"""Loopback-only web application; independent FreeCAD process, shared Laya service."""
from pathlib import Path
import sys, os, json, subprocess, uuid, threading, time, argparse, mimetypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.parse import urlsplit, unquote

ROOT=Path(__file__).resolve().parent
SHARED=ROOT.parent/'cad_tools'
sys.path.insert(0,str(SHARED))
from core import load,save,runtimes,digest,VERSION
from cam import CATALOG,default_settings,build_plan,gcode
import laya_client
DATA=ROOT/'data'; DATA.mkdir(exist_ok=True)
JOBS={}; LOCK=threading.Lock(); CAD_LOCK=threading.Lock(); MODEL_LOCK=threading.Lock()


def worker(*args):
    with CAD_LOCK:
        p=subprocess.run([runtimes()['freecad'],'-B',str(ROOT/'cad_worker.py'),*map(str,args)],
                         capture_output=True,timeout=120,env=dict(os.environ,PYTHONUTF8='1',PYTHONDONTWRITEBYTECODE='1'))
    if p.returncode:
        raise ValueError(p.stderr.decode('utf-8',errors='replace')[-1800:] or 'FreeCAD 讀取失敗')


def new_job(action):
    jobid=uuid.uuid4().hex
    JOBS[jobid]={'state':'running','message':'處理中'}
    def run():
        try:
            result=action()
            JOBS[jobid]={'state':'done','result':result}
        except Exception as exc:
            JOBS[jobid]={'state':'error','message':str(exc)}
    threading.Thread(target=run,daemon=True).start()
    return {'job':jobid}


def load_model(identifier):
    if not isinstance(identifier,str) or len(identifier)!=32 or any(c not in '0123456789abcdef' for c in identifier):
        raise ValueError('無效模型 ID')
    return load(DATA/identifier/'model.json')


def import_model(path,name,identifier):
    output=path.parent/'model.json'
    worker('analyze',path,output)
    model=load(output); model.update(id=identifier,name=name)
    save(output,model)
    return {'model':model,'settings':default_settings(model)}


def ai_plan(model, supplied, use_laya, auto_machine):
    cfg=load(SHARED/'config.json')['laya']
    ai={'status':'NOT_REQUESTED','review_required':False,'executed':False}
    strategy='raster'; settings=dict(supplied)
    if use_laya:
        if not cfg.get('enabled',True):
            ai={'status':'DISABLED','review_required':True,'executed':False}
        else:
            try:
                with MODEL_LOCK:
                    laya_client.start()
                    until=time.monotonic()+30
                    while True:
                        try:
                            health=laya_client.health(); break
                        except Exception:
                            if time.monotonic()>until: raise ValueError('Laya 服務啟動逾時')
                            time.sleep(.5)
                    if health.get('decisions_api')!=1: raise ValueError('舊 Laya 服務不支援 CNC 決策；請重新啟動共用服務')
                    candidates={m['id']:f'{m["name"]}: XYZ travel {m["travel"]} mm, rpm {m["rpm"]}. Prefer smallest suitable machine.' for m in CATALOG['machines']}
                    task=json.dumps({'request':'Choose a three axis milling machine and a rough pocket strategy. Plan only, no execution.',
                        'size_mm':model['size'],'features':model['features'],'material':settings['material'],
                        'stock_mm':[settings['stock_x'],settings['stock_y'],settings['stock_z']]},ensure_ascii=False)
                    body={'task':task[:3000], 'decisions':{
                        'machine':{'type':'choice','instructions':'Choose the smallest suitable three-axis FANUC template by required size. Final travel validation is deterministic.','criteria':candidates},
                        'strategy':{'type':'choice','instructions':'Choose rough pocket clearing strategy. Use raster for rectangular open pockets.','criteria':{
                            'raster':'Zigzag raster lanes for simple rectangular pocket roughing.',
                            'contour':'Concentric rectangular clearing plus a central raster pass.'}}}}
                    req=Request(laya_client.endpoint()+'/decide',json.dumps(body).encode(),{'Content-Type':'application/json'})
                    with urlopen(req,timeout=180) as res: raw=json.load(res)
                answers=raw['raw']['answers']
                if answers['machine']['choice'] not in candidates or answers['strategy']['choice'] not in ('raster','contour'):
                    raise ValueError('Laya 選項未通過檢查')
                strategy=answers['strategy']['choice']
                if auto_machine: settings['machine']=answers['machine']['choice']
                ai={'status':'MODEL_RESULT','review_required':raw['review_required'],'executed':False,
                    'answers':answers,'usage':raw['raw'].get('usage',{}),'model':cfg['model'],'revision':cfg['model_revision']}
            except Exception as exc:
                ai={'status':'UNAVAILABLE','message':str(exc),'review_required':True,'executed':False}
    plan=build_plan(model,settings,strategy)
    plan['ai']=ai; plan['model_id']=model['id']; plan['source_sha256']=model['audit']['sha256']
    if use_laya and ai['status']!='MODEL_RESULT':
        plan['blockers'].append('Laya 未完成決策。可修復服務，或明確關閉本次 Laya 後使用規則規劃。')
        plan['status']='BLOCKED'
    if ai['status']=='MODEL_RESULT' and ai['review_required']:
        plan['ai_review_blocker']='Laya 建議信心偏低或輸入截斷，需檢視母機及策略並確認採用。'
        plan['blockers'].append(plan['ai_review_blocker'])
        plan['status']='BLOCKED'
    identifier=uuid.uuid4().hex; plan['id']=identifier
    save(DATA/('plan_'+identifier+'.json'),plan)
    return plan


class Handler(BaseHTTPRequestHandler):
    server_version='CNCStudio/0.1'
    def send(self,status,body,kind='application/json; charset=utf-8',download=None):
        if not isinstance(body,bytes): body=json.dumps(body,ensure_ascii=False,allow_nan=False).encode()
        self.send_response(status)
        self.send_header('Content-Type',kind); self.send_header('Content-Length',str(len(body)))
        self.send_header('X-Content-Type-Options','nosniff'); self.send_header('Cache-Control','no-store')
        self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'")
        if download: self.send_header('Content-Disposition',f'attachment; filename="{download}"')
        self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        try:
            host=self.headers.get('Host','')
            if host not in self.server.allowed_hosts: return self.send(403,{'error':'Invalid Host'})
            path=urlsplit(self.path).path
            if path=='/api/status':
                cfg=load(SHARED/'config.json')
                try: health=laya_client.health()
                except Exception: health={'loaded':False,'service':'stopped'}
                return self.send(200,{'version':'0.1.0','shared_version':VERSION,'laya_enabled':cfg['laya']['enabled'],'laya':health,'catalog':CATALOG})
            if path.startswith('/api/job/'):
                return self.send(200,JOBS.get(path.rsplit('/',1)[1],{'state':'error','message':'工作不存在'}))
            if path.startswith('/api/download/'):
                identifier=path.rsplit('/',1)[1]
                if len(identifier)!=32 or any(c not in '0123456789abcdef' for c in identifier): raise ValueError('無效計畫')
                plan=load(DATA/('plan_'+identifier+'.json'))
                return self.send(200,gcode(plan).encode('ascii'),'text/plain; charset=ascii','O1001_FANUC_DRAFT.nc')
            if path not in ('/','/app.js','/style.css'): return self.send(404,{'error':'Not found'})
            file=ROOT/'web'/('index.html' if path=='/' else path[1:])
            return self.send(200,file.read_bytes(),(mimetypes.guess_type(file)[0] or 'text/plain')+'; charset=utf-8')
        except (ValueError,FileNotFoundError) as exc: self.send(400,{'error':str(exc)})
    def do_POST(self):
        try:
            host=self.headers.get('Host','')
            origin=self.headers.get('Origin')
            if host not in self.server.allowed_hosts or (origin and origin != 'http://'+host):
                return self.send(403,{'error':'Only same-origin local requests accepted'})
            size=int(self.headers.get('Content-Length','0'))
            if not 0<=size<=50*1024*1024: raise ValueError('STEP 上限 50 MB')
            body=self.rfile.read(size)
            if self.path=='/api/upload':
                name=unquote(self.headers.get('X-Filename','part.step')).replace('\\','/').rsplit('/',1)[-1][:160]
                if not name.lower().endswith(('.step','.stp')): raise ValueError('請選 STEP 或 STP')
                if b'ISO-10303-21' not in body[:4096].upper(): raise ValueError('不是可讀取的 STEP Part 21 檔案')
                identifier=uuid.uuid4().hex; folder=DATA/identifier; folder.mkdir()
                file=folder/'source.step'; file.write_bytes(body)
                return self.send(202,new_job(lambda:import_model(file,name,identifier)))
            data=json.loads(body or b'{}')
            if self.path=='/api/demo':
                identifier=uuid.uuid4().hex; folder=DATA/identifier; folder.mkdir()
                def action():
                    file=folder/'source.step'; worker('demo',file)
                    return import_model(file,'Demo_plate_100x70.step',identifier)
                return self.send(202,new_job(action))
            if self.path=='/api/plan':
                model=load_model(data['model_id'])
                if type(data.get('use_laya')) is not bool or type(data.get('auto_machine')) is not bool: raise ValueError('請明確指定 Laya 與母機模式')
                # Validate before expensive inference.
                from cam import settings
                settings(model,data['settings'])
                return self.send(202,new_job(lambda:ai_plan(model,data['settings'],data['use_laya'],data['auto_machine'])))
            if self.path=='/api/confirm-ai':
                identifier=data.get('plan_id','')
                if len(identifier)!=32 or any(c not in '0123456789abcdef' for c in identifier): raise ValueError('無效計畫')
                file=DATA/('plan_'+identifier+'.json')
                with LOCK:
                    plan=load(file)
                    if not plan.get('ai_review_blocker') or plan['ai']['status']!='MODEL_RESULT': raise ValueError('此計畫無待確認 AI 建議')
                    plan['blockers']=[b for b in plan['blockers'] if b!=plan['ai_review_blocker']]
                    plan['ai']['user_reviewed_at']=time.strftime('%Y-%m-%dT%H:%M:%S%z')
                    plan['status']='BLOCKED' if plan['blockers'] else 'DRAFT'
                    save(file,plan)
                return self.send(200,plan)
            return self.send(404,{'error':'Not found'})
        except (ValueError,KeyError,TypeError,FileNotFoundError) as exc: self.send(400,{'error':str(exc)})
        except Exception as exc: self.send(500,{'error':str(exc)})


if __name__=='__main__':
    p=argparse.ArgumentParser(); p.add_argument('--port',type=int,default=8788); args=p.parse_args()
    server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    server.allowed_hosts={f'127.0.0.1:{args.port}',f'localhost:{args.port}'}
    print(f'CNC Studio ready at http://127.0.0.1:{args.port}',flush=True)
    server.serve_forever()
