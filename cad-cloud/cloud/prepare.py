"""Only executes on GitHub Actions; untrusted JSON never enters shell code."""
import json, os, pathlib, re, sys, uuid
ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'engine'))
from requirements import validate

def normalize(raw):
    if not isinstance(raw, dict):
        raise ValueError('需求必須是 JSON 物件')
    defaults = json.loads((ROOT / 'engine/config.json').read_text(encoding='utf-8-sig'))
    unknown = set(raw) - set(defaults)
    if unknown:
        raise ValueError('未知欄位: ' + ', '.join(sorted(unknown)))
    c = defaults | raw
    # Browser input can never select a program path or a DWG converter.
    c['require_dwg'] = False
    c['dwg_converter'] = ''
    for k in ['project', 'material']:
        if not isinstance(c[k], str) or len(c[k]) > 80 or any(ord(x) < 32 for x in c[k]):
            raise ValueError('無效文字欄位: ' + k)
    for k in ['check_interference']:
        if not isinstance(c[k], bool):
            raise ValueError(k + ' 必須是布林值')
    for k in c:
        if k.endswith('_mm') and isinstance(c[k], bool):
            raise ValueError(k + ' 必須是數字')
    return validate(c)

def main():
    job = os.environ.get('CAD_JOB_ID', '')
    if os.environ.get('GITHUB_EVENT_NAME') == 'push' and not job:
        job = str(uuid.uuid4())
        with open(os.environ['GITHUB_ENV'], 'a', encoding='utf-8') as stream:
            stream.write('CAD_JOB_ID='+job+'\n')
    if not re.fullmatch(r'[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}', job):
        raise ValueError('工作 ID 必須是 UUID v4')
    raw = os.environ.get('CAD_REQUIREMENTS', '')
    if os.environ.get('GITHUB_EVENT_NAME') == 'push' and not raw:
        raw = (ROOT/'engine/config.json').read_text(encoding='utf-8-sig')
    if len(raw.encode()) > 16000:
        raise ValueError('需求過長')
    c = normalize(json.loads(raw))
    work = ROOT / 'work'
    work.mkdir(exist_ok=True)
    (work / 'requirements.json').write_text(json.dumps(c, ensure_ascii=False, indent=2), encoding='utf-8')
    (work / 'request.json').write_text(json.dumps({'job_id': job, 'project': c['project']}), encoding='utf-8')
    print('VALID_INPUT', c['project'])

if __name__ == '__main__':
    main()
