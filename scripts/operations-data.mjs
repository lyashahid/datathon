import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const bundled = join(
	homedir(),
	'.cache',
	'codex-runtimes',
	'codex-primary-runtime',
	'dependencies',
	'python',
	process.platform === 'win32' ? 'python.exe' : 'bin/python'
);
const candidates = [
	process.env.MOBILITY_PYTHON,
	existsSync(bundled) ? bundled : undefined,
	'python',
	'python3'
].filter((command) => typeof command === 'string');
const python = candidates.find(
	(command) =>
		spawnSync(command, ['--version'], { encoding: 'utf8', windowsHide: true }).status === 0
);
if (!python) throw new Error('Python required. Run npm run data:setup or set MOBILITY_PYTHON.');
const result = spawnSync(python, ['scripts/operations-data.py', ...process.argv.slice(2)], {
	stdio: 'inherit',
	windowsHide: true
});
process.exit(result.status ?? 1);
