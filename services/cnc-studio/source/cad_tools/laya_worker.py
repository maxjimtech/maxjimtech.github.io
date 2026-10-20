"""One resident local Laya model shared by all CAD projects."""
import json
import os
from pathlib import Path
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

from core import HOME, load

os.environ['HF_HOME'] = str(HOME / 'runtime' / 'huggingface')
os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
ROUTER = None
OPTIONS = {
    'step': 'Reimport STEP and check solids, shells, geometry validity, volume and bounds. 檢查 STEP 幾何。',
    'manifest': 'Create file SHA256 manifest for a delivery directory. 建立交付清單。',
    'verify-package': 'Compare delivery files against an existing SHA256 manifest. 核對交付檔案雜湊。',
    'drawing': 'Create or repair native Solid Edge DFT, linked views, dimensions and PDF. 工程出圖。',
    'model': 'Build editable native 3D CAD parts or assemblies from project specifications. 建立原生模型。',
    'preview': 'Render model preview or contact sheet. 繪製預覽圖。',
    'review': 'Ambiguous or unsupported task, or engineering/strength/safety qualification. 需另行審查。'
}


def predict(task, decisions=None):
    global ROUTER
    if not load(HOME / 'config.json')['laya'].get('enabled', True):
        raise ValueError('Laya disabled in shared settings')
    if not isinstance(task, str) or not task.strip() or len(task) > 3000:
        raise ValueError('Task must contain 1..3000 characters')
    from laya import Router
    if ROUTER is None:
        cfg = load(HOME / 'config.json')['laya']
        model_path = HOME / cfg['model_path']
        kwargs = {'models': {'multilingual': (str(model_path), 'multilingual')}} if model_path.is_dir() else {}
        ROUTER = Router(device='cpu', max_loaded=1, **kwargs)
    return ROUTER.predict(task, decisions or {'operation': {'type': 'choice',
                          'instructions': 'Choose the existing CAD operation that best fits the request. Choose review if unclear.',
                          'criteria': OPTIONS}}, model='multilingual', max_len=2048)


def decide(data):
    """Bounded advisory choices for clients; no code, tools or execution."""
    decisions = data.get('decisions')
    if not isinstance(decisions, dict) or not 1 <= len(decisions) <= 4:
        raise ValueError('Expected 1..4 decisions')
    for key, spec in decisions.items():
        if not isinstance(key, str) or not key.isidentifier() or len(key) > 40:
            raise ValueError('Invalid decision key')
        if not isinstance(spec, dict) or set(spec) != {'type', 'instructions', 'criteria'} or spec['type'] != 'choice':
            raise ValueError('Only bounded choice decisions supported')
        criteria = spec['criteria']
        if not isinstance(criteria, dict) or not 2 <= len(criteria) <= 12:
            raise ValueError('Expected 2..12 choices')
        if not isinstance(spec['instructions'], str) or len(spec['instructions']) > 600:
            raise ValueError('Invalid instructions')
        if any(not isinstance(k, str) or len(k) > 60 or not isinstance(v, str) or len(v) > 600 for k, v in criteria.items()):
            raise ValueError('Invalid criteria')
    raw = predict(data.get('task'), decisions)
    import math
    threshold = load(HOME / 'config.json')['laya']['min_confidence']
    review = bool(raw.get('usage', {}).get('truncated'))
    for key, spec in decisions.items():
        answer = raw.get('answers', {}).get(key, {})
        conf = answer.get('confidence')
        if answer.get('choice') not in spec['criteria']:
            raise ValueError('Model returned an unknown choice')
        review |= type(conf) not in (int, float) or not math.isfinite(conf) or not 0 <= conf <= 1 or conf < threshold
    return {'raw': raw, 'review_required': review, 'executed': False}


class Handler(BaseHTTPRequestHandler):
    def respond(self, status, data):
        body = json.dumps(data, ensure_ascii=False, allow_nan=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path != '/health':
            return self.respond(404, {'error': 'Not found'})
        self.respond(200, {'service': 'cad-tools-laya', 'loaded': ROUTER is not None,
                           'model': 'multilingual', 'execution': 'suggestions-only', 'decisions_api': 1})

    def do_POST(self):
        if self.path not in ('/route', '/decide'):
            return self.respond(404, {'error': 'Not found'})
        try:
            n = int(self.headers.get('Content-Length', '0'))
            if not 0 < n <= 16000:
                raise ValueError('Request too large or empty')
            data = json.loads(self.rfile.read(n))
            self.respond(200, decide(data) if self.path == '/decide' else predict(data['task']))
        except Exception as e:
            self.respond(503, {'error': str(e), 'status': 'MODEL_UNAVAILABLE', 'executed': False})


if __name__ == '__main__':
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument('--smoke', help='Run one real prediction and save the result')
    a = p.parse_args()
    if a.smoke:
        from core import save
        save(a.smoke, predict('請重新匯入 STEP 並檢查實體數量、封閉性、體積及外形尺寸'))
    else:
        HTTPServer(('127.0.0.1', load(HOME / 'config.json')['laya']['port']), Handler).serve_forever()
