#!/usr/bin/env node
'use strict';

/*
  Zero-dependency pre-flight checks:
    · every JavaScript file parses (CommonJS + ES modules)
    · every JSON file parses
    · HTML pages reference files that exist
    · no secrets accidentally committed to the browser bundle
  Run with `npm run check`.
*/

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const failures = [];
const checked = { js: 0, json: 0, html: 0 };

function walk(dir, ignore = new Set(['node_modules', '.git', '.vercel', 'vendor'])) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (ignore.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full, ignore));
    else files.push(full);
  }
  return files;
}

function checkScript(file) {
  const source = fs.readFileSync(file, 'utf8');
  const relative = path.relative(ROOT, file);
  const isModule = /^\s*(import|export)\s/m.test(source) || file.endsWith('.mjs');
  try {
    if (isModule) {
      const temp = path.join(os.tmpdir(), `kal-check-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`);
      fs.writeFileSync(temp, source);
      try {
        execFileSync(process.execPath, ['--check', temp], { stdio: 'pipe' });
      } finally {
        fs.unlinkSync(temp);
      }
    } else {
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    }
    checked.js += 1;
  } catch (error) {
    failures.push(`JS syntax: ${relative}\n${(error.stderr || error.message).toString().trim()}`);
  }
}

function checkJson(file) {
  try {
    JSON.parse(fs.readFileSync(file, 'utf8'));
    checked.json += 1;
  } catch (error) {
    failures.push(`JSON parse: ${path.relative(ROOT, file)} — ${error.message}`);
  }
}

function checkHtml(file) {
  const source = fs.readFileSync(file, 'utf8');
  checked.html += 1;
  const refs = [...source.matchAll(/(?:href|src)="(\/[^"#?]+)"/g)].map(match => match[1]);
  const localRefs = refs.filter(ref => !ref.startsWith('/api/'));
  for (const ref of localRefs) {
    const candidates = [
      path.join(ROOT, ref),
      path.join(ROOT, `${ref}.html`),
      path.join(ROOT, ref.replace(/\/$/, ''), 'index.html')
    ];
    if (!candidates.some(candidate => fs.existsSync(candidate))) {
      failures.push(`HTML reference: ${path.relative(ROOT, file)} points to missing ${ref}`);
    }
  }
}

const files = walk(ROOT).filter(file => {
  const relative = path.relative(ROOT, file);
  return !relative.startsWith('assets/vendor/'); // vendored third-party bundle
});

for (const file of files) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.js' || ext === '.mjs') checkScript(file);
  else if (ext === '.json') checkJson(file);
  else if (ext === '.html') checkHtml(file);
}

// Triple-check the vendored bundle as an ES module (it is served as one).
checkScript(path.join(ROOT, 'assets/vendor/three.module.min.js'));

// Secrets must never appear in browser-delivered files.
const browserFiles = files.filter(file => {
  const relative = path.relative(ROOT, file);
  return relative.startsWith('assets/') && /\.(js|css)$/.test(relative) && !relative.includes('/vendor/');
});
const forbidden = [
  { pattern: /PAYMOB_SECRET_KEY|PAYMOB_HMAC_SECRET|RESEND_API_KEY|R2_SECRET_ACCESS_KEY|DOWNLOAD_TOKEN_SECRET|PAYMENT_SIGNING_SECRET/, label: 'secret variable name' },
  { pattern: /\bsk_(test|live)_[A-Za-z0-9]{10,}/, label: 'Paymob secret key' },
  { pattern: /\bre_[A-Za-z0-9]{16,}/, label: 'Resend key' }
];
for (const file of browserFiles) {
  const source = fs.readFileSync(file, 'utf8');
  for (const rule of forbidden) {
    if (rule.pattern.test(source)) failures.push(`Secret exposure: ${path.relative(ROOT, file)} contains a ${rule.label}`);
  }
}

console.log(`Checked ${checked.js} scripts, ${checked.json} JSON files, ${checked.html} HTML pages.`);

if (failures.length) {
  console.error(`\n${failures.length} problem(s):\n`);
  failures.forEach(failure => console.error(`  ✗ ${failure}`));
  process.exit(1);
}

console.log('✓ All checks passed.');
