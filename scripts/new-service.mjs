#!/usr/bin/env node
// Scaffold a new accessibility service from templates/.
//
//   node scripts/new-service.mjs <service-id> [ts|py]
//   pnpm new:service <service-id> [ts|py]
//   task new:service -- <service-id> [ts|py]
//
// Creates services/<service-id> from the matching template, substitutes tokens,
// and registers it with the right workspace manager. TS services are picked up
// automatically by the pnpm `services/*` glob; Python services are appended to the
// uv workspace members in the root pyproject.toml.

import {
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

const [, , idArg, langArg = 'ts'] = process.argv;
if (!idArg) fail('usage: node scripts/new-service.mjs <service-id> [ts|py]');

const id = idArg.toLowerCase();
if (!/^[a-z][a-z0-9-]*$/.test(id)) {
  fail(`invalid id "${idArg}" — use kebab-case, e.g. "eye-tracking"`);
}
const lang = langArg.toLowerCase();
if (!['ts', 'py'].includes(lang)) fail(`lang must be "ts" or "py", got "${langArg}"`);

const words = id.split('-');
const tokens = {
  __SERVICE_ID__: id,
  __SERVICE_NAME__: words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' '),
  __SERVICE_CLASS__: words.map((w) => w[0].toUpperCase() + w.slice(1)).join(''),
  __PKG_NAME__: `@aah/${id}`,
  __PY_PKG__: id.replace(/-/g, '_'),
};

const dest = join(repoRoot, 'services', id);
if (existsSync(dest)) fail(`services/${id} already exists`);

const templateDir = join(repoRoot, 'templates', lang === 'ts' ? 'service-ts' : 'service-py');
cpSync(templateDir, dest, { recursive: true });

if (lang === 'py') {
  renameSync(join(dest, 'service_pkg'), join(dest, tokens.__PY_PKG__));
}

// Substitute tokens in every generated file.
function substitute(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      substitute(p);
    } else {
      let content = readFileSync(p, 'utf8');
      for (const [token, value] of Object.entries(tokens)) {
        content = content.split(token).join(value);
      }
      writeFileSync(p, content);
    }
  }
}
substitute(dest);

// Register with the workspace manager.
if (lang === 'ts') {
  // pnpm picks it up via the `services/*` glob. Add it to the root TS solution so
  // editors and `tsc -b` from the root see it too.
  const tsconfigPath = join(repoRoot, 'tsconfig.json');
  const tsconfig = readFileSync(tsconfigPath, 'utf8');
  if (!tsconfig.includes(`"./services/${id}"`)) {
    writeFileSync(
      tsconfigPath,
      tsconfig.replace(
        /("references":\s*\[)(\r?\n)/,
        (_m, open, nl) => `${open}${nl}    { "path": "./services/${id}" },${nl}`,
      ),
    );
  }
} else {
  // Append to the uv workspace members.
  const pyprojectPath = join(repoRoot, 'pyproject.toml');
  const pyproject = readFileSync(pyprojectPath, 'utf8');
  if (!pyproject.includes(`"services/${id}"`)) {
    writeFileSync(
      pyprojectPath,
      pyproject.replace(
        /(members = \[\r?\n)([\s\S]*?)(\r?\n\])/,
        (_m, open, body, close) => `${open}${body}\n  "services/${id}",${close}`,
      ),
    );
  }
}

console.log(`\nCreated services/${id} (${lang}).`);
console.log('Next:');
console.log('  1. Fill in `requires` and the lifecycle hooks.');
if (lang === 'ts') {
  console.log('  2. Install it into the shell or a launcher (see apps/shell/src/bootstrap.ts).');
} else {
  console.log('  2. Wire it to the kernel IPC bridge in its __main__.py.');
}
console.log('  3. Run `task install` then `task build` / `task test`.\n');
