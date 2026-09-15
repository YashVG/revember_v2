import { cp, mkdir, mkdtemp, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const mcpRoot = fileURLToPath(new URL('..', import.meta.url));
const repository = path.dirname(mcpRoot);
const builds = path.join(repository, '.aws-build');
await mkdir(builds, { recursive: true });
const output = await mkdtemp(path.join(builds, 'mcp-'));
const staging = path.join(output, 'bundle');
const mcp = path.join(staging, 'mcp-server');
execFileSync('npm', ['run', 'build'], { cwd: mcpRoot, stdio: 'inherit' });
await mkdir(path.join(mcp, 'dist'), { recursive: true });
for (const name of await readdir(path.join(mcpRoot, 'dist'))) {
  if (name.endsWith('.js')) await cp(path.join(mcpRoot, 'dist', name), path.join(mcp, 'dist', name));
}
for (const name of ['package.json', 'package-lock.json']) await cp(path.join(mcpRoot, name), path.join(mcp, name));
execFileSync('npm', ['ci', '--omit=dev', '--ignore-scripts'], { cwd: mcp, stdio: 'inherit' });
await cp(path.join(repository, 'topic-authoring'), path.join(staging, 'topic-authoring'), { recursive: true });
const zip = path.join(output, 'revember-mcp.zip');
execFileSync('zip', ['-q', '-r', zip, 'mcp-server', 'topic-authoring'], { cwd: staging, stdio: 'inherit' });
console.log(`Lambda artifact: ${zip}`);
