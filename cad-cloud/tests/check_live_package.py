"""Verify downloaded production delivery without running CAD on a client."""
import hashlib, io, json, os, pathlib, zipfile
if os.environ.get('GITHUB_ACTIONS') != 'true':
    raise RuntimeError('Use a GitHub-hosted runner.')
root = pathlib.Path('test-results/live')
report = json.loads((root/'report.json').read_text())
with zipfile.ZipFile(root/'CAD-delivery.zip') as archive:
    assert archive.testzip() is None
    names = archive.namelist()
    assert all(not pathlib.PurePosixPath(n).is_absolute() and '..' not in pathlib.PurePosixPath(n).parts for n in names)
    manifest = json.loads(archive.read('delivery_manifest.json'))
    for name, digest in manifest.items():
        assert hashlib.sha256(archive.read(name)).hexdigest() == digest, name
    assert 'STEP/Assembly.step' in names
    assert len([n for n in names if n.lower().endswith('.step')]) == 4
    assert len([n for n in names if n.lower().endswith('.dxf')]) == 4
    native = [n for n in names if n.lower().endswith('.fcstd')]
    assert len(native) == 1
    with zipfile.ZipFile(io.BytesIO(archive.read(native[0]))) as document:
        xml = document.read('Document.xml')
        assert b'TechDraw::DrawPage' in xml and b'Part::Cylinder' in xml
        assert b'CNCFiniteCylinderSweep' in xml
    validation = json.loads(archive.read('validation.json'))
    assert validation['assembly_occurrences'] == 22
    assert validation['reopen_native_solids'] == [1, 1, 1]
    assert all(validation['reopen_native_valid'])
    assert len(validation['reopen_native_volume_checks']) == 3
    for native_check in validation['reopen_native_volume_checks']:
        assert abs(native_check['saved_volume_mm3']-native_check['reopened_volume_mm3']) <= max(.001,abs(native_check['saved_volume_mm3'])*1e-5)
    independent = validation['step_independent_process']
    assert independent['status'] == 'PASS'
    assert not validation['interferences']
    steps = validation['step_reopen']
    assert len(steps) == 4
    for step in steps:
        assert step['valid'] and step['closed']
        assert step['solids'] == (22 if step['file'] == 'Assembly.step' else 1)
        assert abs(step['source_volume_mm3']-step['step_volume_mm3']) <= max(.001, abs(step['source_volume_mm3'])*1e-5)
    report['package_audit'] = {'crc_pass': True, 'manifest_hashes_pass': len(manifest), 'native_documents': native, 'steps': steps}
report['status'] = 'FULL_ANONYMOUS_FLOW_AND_PACKAGE_PASS'
(root/'report.json').write_text(json.dumps(report, indent=2))
print(report['status'], report['job_id'])
