"""Invoke the project's existing DXF preview renderer with a selected output path."""
import pathlib, runpy, sys
ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.argv = [str(ROOT / 'engine/render_dxf_preview.py'), sys.argv[1]]
runpy.run_path(str(ROOT / 'engine/render_dxf_preview.py'), run_name='__main__')
