"""Publish preview metadata to cad-results; deliver complete CAD through Releases.

Uses the ephemeral Actions token. Never receives the browser's personal token.
"""
import base64, datetime, hashlib, json, os, pathlib, re, time, urllib.error, urllib.request, zipfile
ROOT = pathlib.Path(__file__).resolve().parents[1]

def request(path, data=None, method=None, binary=None):
    url = path if path.startswith('https://') else 'https://api.github.com' + path
    if not url.startswith(('https://api.github.com/', 'https://uploads.github.com/')):
        raise ValueError('Unsupported API host')
    headers = {'Authorization': 'Bearer ' + os.environ['GH_TOKEN'],
               'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
               'User-Agent': 'RD065-Cloud/2.0'}
    body = binary
    if data is not None:
        body = json.dumps(data).encode()
        headers['Content-Type'] = 'application/json'
    if binary is not None:
        headers['Content-Type'] = 'application/zip'
    req = urllib.request.Request(url, data=body, headers=headers, method=method or ('POST' if body is not None else 'GET'))
    with urllib.request.urlopen(req, timeout=180) as response:
        raw = response.read()
        return json.loads(raw) if raw else None

def commit_results(files, job, repo):
    api = '/repos/' + repo
    blobs = []
    for path, content in files.items():
        blob = request(api+'/git/blobs', {'content': base64.b64encode(content).decode(), 'encoding': 'base64'})
        blobs.append({'path': path if path=='latest.json' else job+'/'+path, 'mode': '100644', 'type': 'blob', 'sha': blob['sha']})
    for retry in range(6):
        try:
            try:
                ref = request(api+'/git/ref/heads/cad-results')
            except urllib.error.HTTPError as error:
                if error.code != 404:
                    raise
                # Separate results branch; no generated files are pushed to main.
                main = request(api+'/git/ref/heads/'+os.environ.get('GITHUB_REF_NAME', 'main'))
                try:
                    request(api+'/git/refs', {'ref': 'refs/heads/cad-results', 'sha': main['object']['sha']})
                except urllib.error.HTTPError as conflict:
                    if conflict.code != 422:
                        raise
                ref = request(api+'/git/ref/heads/cad-results')
            parent = ref['object']['sha']
            tree = request(api+'/git/commits/'+parent)['tree']['sha']
            newtree = request(api+'/git/trees', {'base_tree': tree, 'tree': blobs})
            commit = request(api+'/git/commits', {'message': 'CAD result '+job, 'tree': newtree['sha'], 'parents': [parent]})
            request(api+'/git/refs/heads/cad-results', {'sha': commit['sha'], 'force': False}, method='PATCH')
            return
        except urllib.error.HTTPError as error:
            if error.code not in (409, 422) or retry == 5:
                raise
            time.sleep(retry+1)

def main():
    job = os.environ.get('CAD_JOB_ID', '')
    if not re.fullmatch(r'[a-f0-9-]{36}', job):
        raise ValueError('Invalid job ID')
    work = ROOT/'work'
    out = work/'output'
    repo = os.environ['GITHUB_REPOSITORY']
    success = (work/'success.json').exists() and os.environ.get('CAD_BUILD_OUTCOME') == 'success'
    result = {'job_id': job, 'status': 'completed' if success else 'failed',
              'created_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'run_url': 'https://github.com/'+repo+'/actions/runs/'+os.environ['GITHUB_RUN_ID'],
              'review_only': True}
    files = {}
    if success:
        result.update(json.loads((work/'success.json').read_text(encoding='utf-8')))
        result['validation'] = json.loads((out/'validation.json').read_text(encoding='utf-8'))
        result['requirements'] = json.loads((work/'requirements.json').read_text(encoding='utf-8'))
        files['preview.json'] = (out/'preview.json').read_bytes()
        for image in (out/'Preview').glob('*.png'):
            files['drawings/'+image.name] = image.read_bytes()
        delivered = [p for p in out.rglob('*') if p.is_file() and p.name != 'NativeGeometry.FCStd' and p.suffix.lower() not in ('.fcstd1', '.fcbak')]
        manifest = {str(p.relative_to(out)).replace('\\','/'): hashlib.sha256(p.read_bytes()).hexdigest() for p in delivered}
        (out/'delivery_manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
        package = work/'CAD-delivery.zip'
        with zipfile.ZipFile(package, 'w', zipfile.ZIP_DEFLATED) as archive:
            for p in delivered+[out/'delivery_manifest.json']:
                archive.write(p, str(p.relative_to(out)).replace('\\','/'))
            for name in ['native_features.py', 'OpenGenerated.FCMacro']:
                archive.write(ROOT/'engine'/name, name)
        with zipfile.ZipFile(package) as archive:
            if archive.testzip():
                raise RuntimeError('Delivery archive CRC failed')
        release = request('/repos/'+repo+'/releases', {'tag_name': 'cad-'+job, 'target_commitish': os.environ['GITHUB_SHA'],
                          'name': result['project']+' / '+job[:8], 'body': 'FreeCAD native review model, STEP, DXF, preview and validation. Not a manufacturing release.', 'draft': False, 'prerelease': True})
        upload = release['upload_url'].split('{')[0]+'?name=CAD-delivery.zip'
        asset = request(upload, binary=package.read_bytes())
        result['download_url'] = asset['browser_download_url']
        result['release_url'] = release['html_url']
        result['package_sha256'] = hashlib.sha256(package.read_bytes()).hexdigest()
        result['files'] = list(manifest)
    else:
        result['message'] = '雲端工作未完成，請從執行紀錄與 Artifact 查看錯誤；不能作為合格模型。'
    files['result.json'] = json.dumps(result, ensure_ascii=False).encode()
    if success:
        files['latest.json'] = files['result.json']
    commit_results(files, job, repo)
    summary = pathlib.Path(os.environ['GITHUB_STEP_SUMMARY'])
    with summary.open('a', encoding='utf-8') as stream:
        stream.write('## CAD '+job+'\n\nStatus: '+result['status']+'\n\n')
        if success:
            stream.write('[Download package]('+result['release_url']+')\n\nSHA256: `'+result['package_sha256']+'`\n')
    print('PUBLISHED', result['status'], job)

if __name__ == '__main__':
    main()
