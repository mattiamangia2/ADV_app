#!/usr/bin/env node
// Blocks commits that contain secrets or sensitive files.
// Runs automatically as a git pre-commit hook (installed by `npm install`).
// Usage: node scripts/check-secrets.mjs            -> checks staged files
//        node scripts/check-secrets.mjs --all      -> checks every tracked file
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const all = process.argv.includes('--all');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
const files = (all ? git('ls-files') : git('diff', '--cached', '--name-only', '--diff-filter=ACMR'))
  .split('\n').filter(Boolean);

const FORBIDDEN_FILES = [
  /(^|\/)\.env(\.(?!example$)[^/]*)?$/, /\.(pem|key|p12|pfx|jks|keystore|kdbx)$/i, /(^|\/)id_(rsa|ed25519|ecdsa)/,
  /credentials.*\.json$/i, /service-account.*\.json$/i, /(^|\/)\.npmrc$/, /(^|\/)\.netrc$/, /\.(db|sqlite3?)$/i,
];
const PATTERNS = [
  ['Private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['AWS access key', /\b(AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['GitHub token', /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{50,}/],
  ['Anthropic API key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['OpenAI-style API key', /\bsk-(proj-)?[A-Za-z0-9]{32,}/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['Stripe key', /\b(sk|rk)_live_[A-Za-z0-9]{20,}/],
  ['Mapbox secret token', /\bsk\.eyJ[A-Za-z0-9_-]{20,}/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['Password in connection string', /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@/]{3,}@/i],
  ['Hard-coded secret', /\b(api[_-]?key|secret|token|passw(or)?d|client[_-]?secret)\b\s*[:=]\s*['"][^'"\s]{12,}['"]/i],
];
const SKIP = [/package-lock\.json$/, /^scripts\/check-secrets\.mjs$/];

const problems = [];
for (const f of files) {
  if (FORBIDDEN_FILES.some((r) => r.test(f))) { problems.push(`${f}: sensitive file type — should not be committed`); continue; }
  if (SKIP.some((r) => r.test(f)) || !fs.existsSync(f)) continue;
  const text = all ? fs.readFileSync(f, 'utf8') : git('show', `:${f}`);
  if (text.includes('\0')) continue; // binary
  text.split('\n').forEach((line, i) => {
    if (/secret-scan:\s*allow/.test(line)) return;
    for (const [name, re] of PATTERNS) if (re.test(line)) problems.push(`${f}:${i + 1}: possible ${name}`);
  });
}

if (problems.length) {
  console.error('\n✋ Commit blocked: possible secrets found\n');
  for (const p of problems) console.error('  ' + p);
  console.error('\nMove secrets to .env (ignored by git). If this is a false positive, add the comment');
  console.error('"secret-scan: allow" on that line, or bypass once with: git commit --no-verify\n');
  process.exit(1);
}
if (all) console.log(`✓ No secrets found in ${files.length} tracked files`);
