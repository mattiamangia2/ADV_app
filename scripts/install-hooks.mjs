// Enables the pre-commit secret check. Safe no-op when git or the .git folder is missing (e.g. ZIP download).
import { execFileSync } from 'node:child_process';
try {
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'ignore' });
} catch {
  // not a git checkout — nothing to do
}
