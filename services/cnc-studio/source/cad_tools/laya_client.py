"""Dependency-free client; never executes a model-selected operation."""
import json
import math
import os
from pathlib import Path
import subprocess
from urllib.request import Request, urlopen
from urllib.error import URLError

from core import HOME, load, save, stamp


def endpoint():
    return 'http://127.0.0.1:' + str(load(HOME / 'config.json')['laya']['port'])


def health():
    with urlopen(endpoint() + '/health', timeout=2) as response:
        data = json.load(response)
    if data.get('service') != 'cad-tools-laya':
        raise ValueError('Configured port is not the CAD Laya service')
    return data


def start():
    if not load(HOME / 'config.json')['laya'].get('enabled', True):
        return {'status': 'DISABLED', 'executed': False}
    try:
        return health()
    except (URLError, TimeoutError, OSError):
        pass
    exe = HOME / 'runtime' / 'laya' / 'Scripts' / 'python.exe'
    if not exe.is_file():
        raise ValueError('Laya environment unavailable; see README')
    (HOME / 'reports').mkdir(exist_ok=True)
    with (HOME / 'reports' / 'laya_service.log').open('ab') as log:
        child = subprocess.Popen([str(exe), '-B', str(HOME / 'laya_worker.py')], cwd=HOME,
                                 stdout=log, stderr=log,
                                 creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0,
                                 env=dict(os.environ, PYTHONDONTWRITEBYTECODE='1', PYTHONUTF8='1'))
    return {'status': 'STARTING', 'pid': child.pid, 'endpoint': endpoint()}


def route(task):
    if not load(HOME / 'config.json')['laya'].get('enabled', True):
        return {'status': 'DISABLED', 'executed': False, 'review_required': True}
    health()
    body = json.dumps({'task': task}, ensure_ascii=False).encode('utf-8')
    request = Request(endpoint() + '/route', body, {'Content-Type': 'application/json'}, method='POST')
    with urlopen(request, timeout=180) as response:
        raw = json.load(response)
    answer = raw['answers']['operation']
    choice = answer.get('choice')
    confidence = answer.get('confidence')
    options = {'step', 'manifest', 'verify-package', 'drawing', 'model', 'preview', 'review'}
    if choice not in options:
        raise ValueError('Invalid model operation')
    numeric = type(confidence) in (int, float) and math.isfinite(confidence) and 0 <= confidence <= 1
    threshold = load(HOME / 'config.json')['laya']['min_confidence']
    result = {'created_at': stamp(), 'task': task, 'suggestion': choice,
              'confidence': confidence, 'review_required': (choice == 'review' or not numeric or confidence < threshold
                                                          or bool(raw.get('usage', {}).get('truncated'))),
              'executed': False, 'raw': raw,
              'scope': 'Model routing suggestion only; does not establish CAD or engineering validity.'}
    save(HOME / 'reports' / 'last_laya_route.json', result)
    return result
