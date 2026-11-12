"""Run replica-design's contrast.py on both the light and dark palettes."""
import json, subprocess, sys, tempfile, os
here = os.path.dirname(os.path.abspath(__file__))
t = json.load(open(os.path.join(here, 'tokens.json'), encoding='utf-8'))
tool = '/tmp/replica-skill/replica-design/contrast.py'
rc = 0
for name, key in (('light', 'color'), ('dark', 'colorDark')):
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as f:
        json.dump({'color': t[key], 'pairs': t['pairs']}, f)
    print(f'===== {name} =====', flush=True)
    rc |= subprocess.call([sys.executable, '-I', tool, f.name])
    os.unlink(f.name)
sys.exit(rc)
