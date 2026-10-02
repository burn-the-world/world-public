"""Check Git history, candidate files, staged blobs and generated release artifacts.

Reports locations and credential types only. Never prints matched values.
"""
from pathlib import Path
import json
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
PATTERNS = {
    'NodeReal credential URL': rb'https?://[^\s"\x27<>]*nodereal\.io/v1/[A-Za-z0-9_-]{16,}',
    'OnFinality credential URL': rb'https?://[^\s"\x27<>]*onfinality\.io/[^\s"\x27<>]*apikey=[A-Za-z0-9_-]{16,}',
    'GitHub token': rb'(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})',
    'Private key assignment': rb'(?i)(?:private[_-]?key|PRIVATE_KEY)\s*[=:]\s*["\x27]?(?:0x)?[0-9a-f]{64}',
    'Secret assignment': rb'(?i)(?:NODEREAL(?:_MAINNET)?_RPC_URL|GITHUB_TOKEN|API_TOKEN|RPC_SECRET)\s*[=:]\s*["\x27]([A-Za-z0-9:/?=&._-]{20,})',
}


def git(*args, data=None):
    return subprocess.check_output(['git', '-c', 'safe.directory=' + ROOT.as_posix(), *args], cwd=ROOT, input=data, stderr=subprocess.DEVNULL)


def main():
    findings = []
    fixtures = []

    def scan(location, data):
        for kind, pattern in PATTERNS.items():
            for match in re.finditer(pattern, data):
                item = {'location': location, 'type': kind, 'line': data[:match.start()].count(b'\n') + 1}
                if b'test-only-placeholder' in match.group():
                    fixtures.append(item)
                else:
                    findings.append(item)

    candidates = [name for name in git('ls-files', '--cached', '--others', '--exclude-standard', '-z').decode().split('\0')
                  if name and (ROOT / name).is_file()]
    for name in candidates:
        scan(name, (ROOT / name).read_bytes())
    staged = [name for name in git('diff', '--cached', '--diff-filter=ACMR', '--name-only', '-z').decode().split('\0') if name]
    for name in staged:
        scan('STAGED:' + name, git('show', ':' + name))

    objects = list(dict.fromkeys(row.split(' ')[0] for row in git('rev-list', '--objects', '--all').decode().splitlines()))
    metadata = git('cat-file', '--batch-check', data=('\n'.join(objects) + '\n').encode()).decode().splitlines() if objects else []
    blobs = [row.split()[0] for row in metadata if row.split()[1] == 'blob']
    payload = git('cat-file', '--batch', data=('\n'.join(blobs) + '\n').encode()) if blobs else b''
    offset = 0
    for blob in blobs:
        end = payload.index(b'\n', offset)
        size = int(payload[offset:end].split()[-1])
        scan('GIT_BLOB:' + blob, payload[end + 1:end + 1 + size])
        offset = end + size + 2

    artifacts = []
    for folder in ['app/dist', 'app/dist-testnet', 'app/.wrangler/dry-run-testnet', 'app/.wrangler/dry-run', 'app/test-results', 'contracts/test-results', 'contracts/out/release']:
        for file in (ROOT / folder).rglob('*'):
            if file.is_file():
                scan(file.relative_to(ROOT).as_posix(), file.read_bytes())
                artifacts.append(file)
    frontend_identifiers = [file.relative_to(ROOT).as_posix() for file in (ROOT / 'app/dist').rglob('*')
                            if file.is_file() and any(marker in file.read_bytes() for marker in [b'NODEREAL_RPC_URL', b'NODEREAL_MAINNET_RPC_URL'])]
    excluded = [name for name in candidates if re.search(
        r'(?:^|/)(?:node_modules|dist|work|cache|build|out|test-results|screenshots)(?:/|$)|\.env\.(?:local|testnet|anvil\.backup)$|\.zip$', name, re.I)]
    result = {'candidateFiles': len(candidates), 'stagedFiles': len(staged), 'reachableGitBlobs': len(blobs),
              'artifactFiles': len(artifacts), 'findings': findings, 'nonfunctionalTestPlaceholders': fixtures,
              'frontendSecretIdentifier': frontend_identifiers, 'excludedFileViolations': excluded}
    output = ROOT / 'app/test-results/security-audit.json'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: value for key, value in result.items() if key != 'nonfunctionalTestPlaceholders'}))
    if findings or frontend_identifiers or excluded:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
