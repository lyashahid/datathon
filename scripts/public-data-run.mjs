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
].filter((value) => typeof value === 'string');
const python = candidates.find(
	(command) =>
		spawnSync(command, ['--version'], { encoding: 'utf8', windowsHide: true }).status === 0
);
if (!python)
	throw new Error(
		'Python 3.11+ is required. Install Python or set MOBILITY_PYTHON to its executable.'
	);
const command = process.argv[2];
const args =
	command === 'setup'
		? ['-m', 'pip', 'install', '-r', 'scripts/public-data-requirements.txt']
		: command === 'prediction'
			? ['scripts/prediction-data.py', ...process.argv.slice(3)]
			: command === 'prediction-test'
				? ['scripts/test_prediction_data.py']
				: ['scripts/public-data.py', command, ...process.argv.slice(3)];
const result = spawnSync(python, args, { stdio: 'inherit', windowsHide: true });
process.exit(result.status ?? 1);
