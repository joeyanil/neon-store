// Writes the commit id of this build into src/version.js, so /health, /connect and the bot menu (for the team) can say
// exactly which version is live. Runs as the first step of `npm run ship`.
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
let sha = process.env.WORKERS_CI_COMMIT_SHA || '';
if (!sha) { try { sha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(); } catch { sha = 'dev'; } }
writeFileSync(new URL('../src/version.js', import.meta.url), `// Written by scripts/stamp-version.mjs during the build.\nexport const VERSION = '${sha.slice(0, 7)}';\n`);
console.log(`version ${sha.slice(0, 7)}`);
