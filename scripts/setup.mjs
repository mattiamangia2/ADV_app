#!/usr/bin/env node
// One-step setup for a new computer: checks requirements, installs dependencies,
// optionally installs the billboard-scout Python library. Safe to run again.
//   node scripts/setup.mjs            app only
//   node scripts/setup.mjs --python   also billboard-scout (needs Python 3.10+)
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const isWin = process.platform === 'win32';
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => console.log(`  ✗ ${m}`);
let failed = false;

console.log('\nADV·Flow setup\n');

// 1. Node.js 22.5+ (the app uses the built-in SQLite)
const [maj, min] = process.versions.node.split('.').map(Number);
if (maj > 22 || (maj === 22 && min >= 5)) ok(`Node.js ${process.versions.node}`);
else {
  bad(`Node.js ${process.versions.node} is too old: install the LTS from https://nodejs.org (22.5 or newer), reopen the terminal, run setup again.`);
  process.exit(1);
}

// 2. Git (needed to get updates with "git pull")
const has = (cmd, args = ['--version']) => spawnSync(cmd, args, { shell: isWin, stdio: 'ignore' }).status === 0;
if (has('git')) ok('Git');
else { bad('Git not found: install it from https://git-scm.com (needed for "git pull" updates).'); }

// 3. JavaScript dependencies
console.log('\nInstalling app dependencies (1–2 minutes the first time)…');
const npm = isWin ? 'npm.cmd' : 'npm';
const r = spawnSync(npm, ['install', '--no-fund', '--no-audit'], { stdio: 'inherit', shell: isWin });
if (r.status === 0) ok('App dependencies installed');
else { bad('npm install failed: see the messages above.'); failed = true; }

// 4. Optional: billboard-scout (Python)
if (process.argv.includes('--python')) {
  console.log('\nInstalling billboard-scout (Python)…');
  const py = ['python3', 'python', 'py'].find((p) => has(p));
  if (!py) bad('Python not found: install Python 3.10+ from https://python.org (tick "Add to PATH"), then run: npm run setup -- --python');
  else {
    const venv = path.join('packages', 'billboard-scout', '.venv');
    if (!fs.existsSync(venv)) execFileSync(py, ['-m', 'venv', venv], { stdio: 'inherit', shell: isWin });
    const pip = path.join(venv, isWin ? 'Scripts' : 'bin', isWin ? 'pip.exe' : 'pip');
    const p = spawnSync(pip, ['install', '-e', 'packages/billboard-scout[dev]'], { stdio: 'inherit' });
    if (p.status === 0) ok(`billboard-scout installed in ${venv} (add [detect,geo] for the AI detector: large download)`);
    else { bad('billboard-scout install failed: see above.'); failed = true; }
  }
}

console.log(failed ? '\nSetup finished with errors (see ✗ above).\n' : `
All set. Start the app with:

    ${isWin ? 'npm.cmd' : 'npm'} run dev

then open http://localhost:5173 in your browser.
The first start downloads Milan's roads from OpenStreetMap (about a minute).
`);
process.exit(failed ? 1 : 0);
