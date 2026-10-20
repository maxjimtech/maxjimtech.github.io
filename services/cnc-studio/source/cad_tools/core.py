"""Shared, dependency-free CAD script inventory and execution services."""
from __future__ import annotations

import ast
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tokenize
from collections import Counter, defaultdict
from datetime import datetime

HOME = Path(__file__).resolve().parent
VERSION = "1.1.0"
EXCLUDED = {'.git', '.venv', 'venv', 'node_modules', '__pycache__', 'site-packages',
            'cad_tools', 'pythonwin', 'win32', 'win32com', 'win32comext',
            'cad_runtime', 'kicad', 'freecad', 'lib', 'libs', 'library', 'libraries',
            'runtime', 'runtimes', 'dependencies', 'deps', 'vendor', '.cache', '.pytest_cache', '.system'}


def stamp():
    from datetime import timezone, timedelta
    return datetime.now(timezone(timedelta(hours=8))).isoformat(timespec='seconds')


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def load(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def save(path, data):
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    temp = p.with_suffix(p.suffix + '.tmp')
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')
    temp.replace(p)


def walk(root, suffixes, errors):
    root = Path(root).resolve()
    if not root.is_dir():
        errors.append({'path': str(root), 'error': 'Directory missing'})
        return
    def onerror(e):
        errors.append({'path': str(e.filename), 'error': str(e)})
    for current, dirs, names in os.walk(root, onerror=onerror, followlinks=False):
        dirs[:] = sorted(d for d in dirs if d.lower() not in EXCLUDED
                         and not d.lower().endswith(('_deps', '.dist-info', '.egg-info'))
                         and not Path(current, d).is_symlink()
                         and not Path(current, d).is_junction())
        for name in sorted(names):
            p = Path(current, name)
            if p.suffix.lower() in suffixes and not p.is_symlink():
                yield p


def classify(path, imports):
    name = path.stem.lower()
    if any(x in imports for x in ('FreeCAD', 'Part', 'OCC', 'Mesh', 'MeshPart', 'FreeCADGui', 'Import')):
        runtime = 'freecad'
    elif any(x in imports for x in ('win32com', 'pythoncom', 'comtypes')):
        runtime = 'com-python'
    else:
        runtime = 'python'
    groups = [('geometry', ('verify', 'measure', 'interference', 'audit', 'validate', 'collision')),
              ('drawing', ('drawing', 'draft', 'dimension', 'dft', 'pdf')),
              ('package', ('package', 'archive', 'delivery', 'hash')),
              ('preview', ('render', 'preview', 'plot', 'contact_sheet')),
              ('model', ('build', 'prepare', 'prototype', 'rebuild')),
              ('research', ('probe', 'inspect', 'extract', 'analy', 'test', 'solve'))]
    category = next((g for g, keys in groups if any(k in name for k in keys)), 'other')
    return runtime, category


def inventory(roots, output):
    rows, errors, functions = [], [], defaultdict(list)
    seen = set()
    for root in roots:
        for path in walk(root, {'.py'}, errors):
            key = str(path).casefold()
            if key in seen:
                continue
            seen.add(key)
            try:
                with tokenize.open(path) as f:
                    source = f.read()
                tree = ast.parse(source, filename=str(path))
                imports = sorted({(n.module or '').split('.')[0] for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)} |
                                 {a.name.split('.')[0] for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names})
                runtime, category = classify(path, imports)
                for n in tree.body:
                    if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.end_lineno - n.lineno >= 5:
                        sig = hashlib.sha256(ast.dump(n, include_attributes=False).encode()).hexdigest()
                        functions[sig].append({'path': str(path), 'name': n.name, 'line': n.lineno})
                rows.append({'id': hashlib.sha256(str(path).encode()).hexdigest()[:16],
                             'path': str(path), 'bytes': path.stat().st_size, 'sha256': digest(path),
                             'ast_sha256': hashlib.sha256(ast.dump(tree, include_attributes=False).encode()).hexdigest(),
                             'runtime_hint': runtime, 'category': category, 'imports': imports,
                             'has_main_guard': '__main__' in source,
                             'review_required': True})
            except (OSError, UnicodeError, SyntaxError, ValueError) as e:
                errors.append({'path': str(path), 'error': str(e)})
    by_hash, by_ast = defaultdict(list), defaultdict(list)
    for row in rows:
        by_hash[row['sha256']].append(row)
        by_ast[row['ast_sha256']].append(row['path'])
    duplicates = [{'sha256': k, 'bytes_each': v[0]['bytes'], 'paths': [r['path'] for r in v],
                   'potential_duplicate_bytes': v[0]['bytes'] * (len(v) - 1)}
                  for k, v in by_hash.items() if len(v) > 1]
    summary = {'scripts': len(rows), 'bytes': sum(r['bytes'] for r in rows),
               'exact_duplicate_groups': len(duplicates),
               'potential_duplicate_bytes': sum(g['potential_duplicate_bytes'] for g in duplicates),
               'categories': dict(Counter(r['category'] for r in rows)),
               'runtime_hints': dict(Counter(r['runtime_hint'] for r in rows)),
               'errors': len(errors)}
    result = {'schema_version': 1, 'version': VERSION, 'created_at': stamp(),
              'roots': [str(Path(r).resolve()) for r in roots], 'exclusions': sorted(EXCLUDED),
              'summary': summary, 'scripts': rows, 'exact_duplicates': duplicates,
              'ast_duplicates': [v for v in by_ast.values() if len(v) > 1],
              'repeated_functions': [v for v in functions.values() if len({x['path'] for x in v}) > 1],
              'errors': errors, 'scope': 'Readable .py source only; excludes dependencies and junctions; ZIP contents not scanned.'}
    save(output, result)
    md = ['# 設計繪圖 Python 盤點', '', f'更新時間：{result["created_at"]}', '',
          f'- 程式：{len(rows)} 支；總大小：{summary["bytes"]:,} bytes',
          f'- 完全重複群組：{len(duplicates)}；理論重複空間：{summary["potential_duplicate_bytes"]:,} bytes',
          f'- 無法讀取或解析：{len(errors)} 筆（詳見 JSON errors）',
          '- 僅盤點可讀取原始碼；排除依賴套件、junction、ZIP 內檔案。分類為靜態推估。',
          '- 重複原始碼仍可能依賴所在路徑、專案資料及舊版交付；不可直接刪除。', '',
          '| 類別 | 數量 |', '|---|---:|']
    md += [f'| {k} | {v} |' for k, v in sorted(summary['categories'].items())]
    md += ['', '## 可共用的完全相同函式', '']
    for group in sorted(result['repeated_functions'], key=len, reverse=True)[:30]:
        md.append(f'- `{group[0]["name"]}`：{len(group)} 處；範例 `{group[0]["path"]}:{group[0]["line"]}`')
    md += ['', '## 完全重複腳本（前 40 群）', '']
    for group in sorted(duplicates, key=lambda g: g['potential_duplicate_bytes'], reverse=True)[:40]:
        md.append(f'- 可重用 {group["potential_duplicate_bytes"]:,} bytes；' + '、'.join(f'`{p}`' for p in group['paths']))
    Path(output).with_suffix('.md').write_text('\n'.join(md) + '\n', encoding='utf-8')
    return summary


def runtimes():
    config = load(HOME / 'config.json')
    return {k: os.path.expandvars(v) for k, v in config['runtimes'].items()}


def settings(reuse=None, laya=None):
    config = load(HOME / 'config.json')
    if reuse is not None:
        config.setdefault('reuse_policy', {})['enabled'] = reuse
    if laya is not None:
        config['laya']['enabled'] = laya
    if reuse is not None or laya is not None:
        save(HOME / 'config.json', config)
    return {'reuse_enabled': config.get('reuse_policy', {}).get('enabled', True),
            'laya_enabled': config['laya'].get('enabled', True),
            'scope': 'Persistent defaults; explicit task choices take precedence. Manual toolkit calls remain available.'}


def plan(script_id, catalog, args, runtime=None):
    data = load(catalog)
    row = next((r for r in data['scripts'] if r['id'] == script_id), None)
    if row is None:
        raise ValueError('Unknown script ID; run inventory/list first')
    path = Path(row['path'])
    if digest(path) != row['sha256']:
        raise ValueError('Source changed since inventory; rescan before running')
    key = runtime or row['runtime_hint']
    if key == 'com-python' and runtime is None:
        raise ValueError('COM runtime requires explicit --runtime com-python after dependency/session review')
    exe = runtimes()[key]
    if not Path(exe).is_file():
        raise ValueError(f'Runtime unavailable: {exe}; update config.json')
    command = [exe, '-B', str(path), *args]
    if key == 'freecad':
        command = [exe, '-B', str(HOME / 'freecad_runner.py'), str(path), *args]
    return {'script_id': script_id, 'source_sha256': row['sha256'], 'cwd': str(path.parent),
            'command': command, 'runtime': key,
            'notice': 'Legacy script executes in its original folder and can modify project files. Review source first.'}


def execute(p):
    # Single host lock: prevents two calls from this launcher mutating CAD concurrently.
    lock = HOME / '.execution.lock'
    fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    try:
        os.write(fd, str(os.getpid()).encode())
        os.close(fd)
        env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1', PYTHONUTF8='1')
        completed = subprocess.run(p['command'], cwd=p['cwd'], env=env, check=False)
        save(HOME / 'reports' / 'last_run.json', dict(p, finished_at=stamp(), returncode=completed.returncode))
        return completed.returncode
    finally:
        lock.unlink(missing_ok=True)


def package_manifest(root, output):
    root, output = Path(root).resolve(), Path(output).resolve()
    errors = []
    rows = []
    for p in walk(root, {'.par', '.asm', '.dft', '.step', '.stp', '.pdf', '.json', '.csv', '.py', '.ps1', '.md'}, errors):
        if p == output or p == output.with_suffix(output.suffix + '.tmp'):
            continue
        rows.append({'path': p.relative_to(root).as_posix(), 'bytes': p.stat().st_size, 'sha256': digest(p)})
    result = {'root': str(root), 'created_at': stamp(), 'files': rows, 'errors': errors,
              'scope': 'Selected CAD/source/report extensions; no native link/geometry/engineering validation.'}
    save(output, result)
    return {'files': len(rows), 'errors': errors}


def verify_manifest(manifest, root):
    data, root = load(manifest), Path(root).resolve()
    failures = []
    for row in data['files']:
        p = (root / row['path']).resolve()
        if not p.is_relative_to(root):
            failures.append({'path': row['path'], 'error': 'Path outside package'})
        elif not p.is_file() or digest(p) != row['sha256']:
            failures.append({'path': row['path'], 'error': 'Missing or hash mismatch'})
    return {'pass': bool(data['files']) and not failures and not data.get('errors'),
            'checked': len(data['files']), 'failures': failures, 'inventory_errors': data.get('errors', []),
            'scope': 'Listed file hash consistency only; extra files and native references not assessed.'}


def judge(metrics, rules):
    """Explicit configurable rules. No inferred meaning or implicit JEV pass."""
    if not rules.get('enabled') or not rules.get('rules'):
        return {'status': 'NOT_CONFIGURED', 'pass': False, 'reason': rules.get('description', '')}
    import math
    import operator
    ops = {'ge': operator.ge, 'le': operator.le, 'eq': operator.eq, 'gt': operator.gt, 'lt': operator.lt}
    results = []
    for rule in rules['rules']:
        field = rule['field']
        actual = metrics.get(field)
        try:
            expected = rule['value']
            op = rule['op']
            if actual is None or op not in ops:
                raise ValueError('Missing metric or unsupported operator')
            if isinstance(actual, float) and not math.isfinite(actual):
                raise ValueError('Non-finite metric')
            if isinstance(expected, float) and not math.isfinite(expected):
                raise ValueError('Non-finite limit')
            if op != 'eq' and (type(actual) not in (int, float) or type(expected) not in (int, float)):
                raise ValueError('Ordered comparisons require numbers')
            ok = type(actual) == type(expected) and actual == expected if op == 'eq' else ops[op](actual, expected)
            results.append({'field': field, 'pass': bool(ok), 'actual': actual, 'op': op, 'value': expected})
        except (KeyError, TypeError, ValueError) as e:
            results.append({'field': field, 'pass': False, 'error': str(e)})
    passed = all(r['pass'] for r in results)
    return {'status': 'PASS' if passed else 'FAIL', 'pass': passed, 'results': results,
            'scope': rules.get('scope', 'Configured rules only')}
