#!/usr/bin/env node
// ---------------------------------------------------------------------------
// harvest-corpus.mjs — build a validated GMAT script corpus from public repos.
//
// Pipeline (the manual process from the project, formalized and reproducible):
//   1. download   — pull each script in the manifest from raw.githubusercontent
//   2. scan       — reject anything with Python/MATLAB interface calls (gate:
//                   --validate executes scripts, so external code must be vetted)
//   3. normalize  — rewrite hardcoded absolute ReportFile paths to bare names
//                   (the #1 portability killer in community scripts)
//   4. validate   — run each headless through the SAME runGmat the MCP uses,
//                   promote only the ones that reach stage "completed"
//   5. index      — write INDEX.md tagging each survivor by detected technique
//
// The corpus itself is gitignored (mixed licenses — local retrieval only).
// What lives in the repo is THIS pipeline plus a manifest of public-repo
// pointers, so anyone can reproduce or extend the corpus.
//
// Usage:
//   node scripts/harvest-corpus.mjs --manifest data/community-scripts/manifest.json
//   node scripts/harvest-corpus.mjs --manifest <file> --validate   # executes scripts
//
// Without --validate it downloads, scans and normalizes only (no execution).
// --validate runs untrusted scripts through GmatConsole: review the manifest
// sources first and prefer a sandbox/VM. Requires GMAT_BIN (see .env.example).
// ---------------------------------------------------------------------------

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, '..');

// ---- args ----
const args = process.argv.slice(2);
function arg(name, fallback = null) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const manifestPath = arg('--manifest', path.join(REPO_ROOT, 'data', 'community-scripts', 'manifest.json'));
const doValidate = args.includes('--validate');
const outRoot = arg('--out', path.join(REPO_ROOT, 'data', 'community-scripts'));

const incomingDir = path.join(outRoot, 'incoming');
const validatedDir = path.join(outRoot, 'validated');

// ---- helpers ----
const SECURITY_RE = /\b(CallPythonFunction|CallMatlabFunction|MatlabFunction|MatlabWorkspace)\b/i;
const HARDCODED_PATH_RE = /(\.Filename\s*=\s*')([^']*[/\\])([^'/\\]+)(')/g;

function detectFeatures(text) {
  const f = [];
  const has = (re) => re.test(text);
  if (/(?:^|\n)\s*(?:GMAT\s+)?Target\s/.test(text)) f.push('targeting');
  if (/(?:^|\n)\s*(?:GMAT\s+)?Optimize\s/.test(text)) f.push('optimization');
  if (has(/BeginFiniteBurn/)) f.push('finite-burn');
  if (has(/Create\s+ImpulsiveBurn/)) f.push('impulsive');
  if (has(/ElectricThruster/)) f.push('electric-prop');
  if (has(/BatchEstimator|ExtendedKalmanFilter|Smoother|Simulator/)) f.push('OD/estimation');
  if (has(/AtmosphereModel\s*=\s*(?!None)\w/)) f.push('drag');
  if (has(/\bLuna\b/)) f.push('Moon');
  if (has(/\bMars\b/)) f.push('Mars');
  if (has(/\bVenus\b/)) f.push('Venus');
  if (has(/BdotT|BdotR/)) f.push('B-plane');
  if (/(?:^|\n)\s*(?:GMAT\s+)?While\s/.test(text)) f.push('loops');
  if (has(/EphemerisFile|Code500|STKEphem|\.oem|SPK/i)) f.push('ephemeris');
  return f;
}

function safeName(repo, scriptPath) {
  return repo.replace(/\//g, '__') + '__' + path.basename(scriptPath).replace(/\s+/g, '_');
}

async function download(repo, scriptPath, ref = 'HEAD') {
  const esc = scriptPath.split('/').map(encodeURIComponent).join('/');
  const url = `https://raw.githubusercontent.com/${repo}/${ref}/${esc}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

// ---- main ----
async function main() {
  if (!fs.existsSync(manifestPath)) {
    console.error(`Manifest not found: ${manifestPath}`);
    console.error('Pass --manifest <file>. See data/community-scripts/manifest.example.json.');
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const entries = manifest.scripts || [];
  fs.mkdirSync(incomingDir, { recursive: true });
  if (doValidate) fs.mkdirSync(validatedDir, { recursive: true });

  // runGmat is imported lazily so download/scan work even without a build/GMAT.
  let runGmat = null;
  if (doValidate) {
    try {
      ({ runGmat } = await import('../dist/utils/gmat.js'));
    } catch {
      console.error('Could not import dist/utils/gmat.js — run `pnpm build` first (--validate needs it).');
      process.exit(1);
    }
    console.warn('\n  --validate executes downloaded scripts in GmatConsole. Vet your manifest; a sandbox is safer.\n');
  }

  const summary = { downloaded: 0, skipped_security: 0, normalized: 0, passed: 0, failed: 0 };
  const indexRows = [];

  for (const e of entries) {
    const name = safeName(e.repo, e.path);
    let text;
    try {
      text = await download(e.repo, e.path, e.ref || 'HEAD');
    } catch (err) {
      console.log(`DL-FAIL  ${name} :: ${err.message}`);
      continue;
    }
    summary.downloaded++;

    if (SECURITY_RE.test(text)) {
      console.log(`SECSKIP  ${name} :: contains Python/MATLAB interface call — not executed`);
      summary.skipped_security++;
      continue;
    }

    if (HARDCODED_PATH_RE.test(text)) {
      text = text.replace(HARDCODED_PATH_RE, '$1$3$4');
      summary.normalized++;
    }
    const incomingPath = path.join(incomingDir, name);
    fs.writeFileSync(incomingPath, text, 'utf8');

    if (!doValidate) {
      console.log(`READY    ${name}`);
      continue;
    }

    const result = await runGmat(text, 60000);
    if (result.ok && result.stage === 'completed') {
      fs.writeFileSync(path.join(validatedDir, name), text, 'utf8');
      indexRows.push(`| ${name} | ${detectFeatures(text).join(', ')} |`);
      console.log(`PASS     ${name}`);
      summary.passed++;
    } else {
      const why = result.errors[0] || `stage=${result.stage}`;
      console.log(`FAIL     ${name} :: ${why}`);
      summary.failed++;
    }
  }

  if (doValidate && indexRows.length) {
    const md =
      `# Validated community corpus index\n\n` +
      `Generated ${new Date().toISOString().slice(0, 10)} — each script reached stage "completed"\n` +
      `via a headless runGmat check. Local retrieval corpus only; mixed licenses, not redistributed.\n\n` +
      `| Script | Detected techniques |\n|---|---|\n` +
      indexRows.sort().join('\n') + '\n';
    fs.writeFileSync(path.join(outRoot, 'INDEX.md'), md, 'utf8');
  }

  console.log('\n--- summary ---');
  console.log(JSON.stringify(summary, null, 2));
  if (doValidate) console.log(`Validated corpus: ${validatedDir}`);
  else console.log(`Downloaded + normalized to: ${incomingDir} (run again with --validate to execute & promote)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
