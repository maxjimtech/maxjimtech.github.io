"""Cloud-only regression checks; intentionally do not launch client-side CAD."""
import importlib.util, json, pathlib, tempfile, unittest
ROOT = pathlib.Path(__file__).resolve().parents[1]
WEB = ROOT/'web' if (ROOT/'web').exists() else ROOT.parent/'services/cad-cloud'
spec = importlib.util.spec_from_file_location('prepare', ROOT/'cloud/prepare.py')
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)

class RequirementsTests(unittest.TestCase):
    def setUp(self):
        self.c=json.loads((ROOT/'engine/config.json').read_text(encoding='utf-8-sig'))
    def test_default_geometry_contract(self):
        c=prepare.normalize(self.c)
        self.assertEqual(c['roller_od_mm'],14)
        self.assertEqual(c['cam_root_mm'],32)
        self.assertEqual(c['ratio'],c['roller_count'])
    def test_never_run_user_converter(self):
        self.c['dwg_converter']='untrusted.exe'
        self.c['require_dwg']=True
        c=prepare.normalize(self.c)
        self.assertEqual(c['dwg_converter'],'')
        self.assertIs(c['require_dwg'],False)
    def test_reject_hole_layout_collision(self):
        self.c['plate_bore_mm']=85
        with self.assertRaises(ValueError):prepare.normalize(self.c)
    def test_reject_nonfinite_bool_and_inconsistent_geometry(self):
        for key,value in [('cam_od_mm',float('inf')),('cam_width_mm',True),('ratio',19),('roller_total_length_mm',25.65)]:
            c=self.c.copy();c[key]=value
            with self.subTest(key=key),self.assertRaises((ValueError,TypeError)):prepare.normalize(c)
    def test_no_client_runtime_configuration(self):
        self.c['worker_command']='malicious'
        with self.assertRaises(ValueError):prepare.normalize(self.c)
    def test_preview_and_native_have_same_inputs(self):
        web=json.loads((WEB/'defaults.json').read_text(encoding='utf-8-sig'))
        self.assertEqual(self.c,web)
    def test_workflow_uses_hosted_runner(self):
        folder=ROOT/'.github' if (ROOT/'.github').exists() else ROOT.parent/'.github'
        workflow=(folder/'workflows/cad.yml').read_text()
        self.assertIn('runs-on: windows-2022',workflow)
        self.assertNotIn('runs-on: self-hosted',workflow)
        self.assertNotIn('${{ inputs.requirements }}',workflow.split('run: python -B cloud/prepare.py')[1])
    def test_pwa_does_not_persist_token(self):
        app=(WEB/'app.js').read_text()
        for line in app.splitlines():
            if 'localStorage.setItem' in line:
                self.assertNotIn('JSON.stringify({token',line)
        sw=(WEB/'sw.js').read_text()
        self.assertIn("u.origin!==location.origin",sw)

if __name__=='__main__':unittest.main()
