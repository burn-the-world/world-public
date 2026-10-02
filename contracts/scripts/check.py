"""Run current checks without rewriting sources, ABI exports or original certificates."""
from pathlib import Path
import json
import os
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def run(command):
    subprocess.run(command, cwd=ROOT, check=True)


def main():
    forge = os.environ.get('FORGE_BIN', 'forge')
    solc = os.environ.get('SOLC_BIN', 'solc')
    run([sys.executable, 'scripts/verify_frozen_inputs.py'])
    run([sys.executable, 'scripts/verify_resistance_math.py'])
    run([sys.executable, 'scripts/verify_treasury_decay_bsc.py'])
    run([forge, 'build', '--use', solc, '--sizes'])
    run([forge, 'test', '--use', solc, '-vv'])
    for name in ['WorldCoreBSCV2', 'WorldTokenBSCV2', 'WorldLandProfileBSCV2', 'WorldDeploymentBSCV2']:
        compiled = json.loads((ROOT / f'out/{name}.sol/{name}.json').read_text(encoding='utf-8'))
        original = json.loads((ROOT / f'abi/{name}.json').read_text(encoding='utf-8-sig'))
        assert compiled['abi'] == original, f'Compiled ABI changed: {name}'
        metadata = compiled['metadata']
        assert metadata['compiler']['version'] == '0.8.30+commit.73712a01', f'Compiler changed: {name}'
        settings = metadata['settings']
        assert settings['evmVersion'] == 'prague', f'Compiled EVM target changed: {name}'
        assert settings['optimizer'] == {'enabled': True, 'runs': 200}, f'Optimizer changed: {name}'
        assert settings.get('viaIR', False) is False, f'viaIR enabled: {name}'
    run([os.environ.get('NODE_BIN', 'node'), '../scripts/verify-release.mjs'])
    print('PASS: current contract checks and four compiled ABIs; original certificates unchanged.')


if __name__ == '__main__':
    if not __debug__:
        raise SystemExit('Run without Python -O; verification assertions are required.')
    main()
