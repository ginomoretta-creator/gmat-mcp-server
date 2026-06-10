// GMAT execution + knowledge utilities for the MCP server.
// Ports the validation harness (run_gmat.py) to TypeScript and exposes the curated
// idioms knowledge and the NASA sample-script corpus.

import { spawn } from 'child_process';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Resolve paths relative to this compiled module (dist/utils/) so the server works
// regardless of the launch working directory. data/ lives at the repo root.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, '..', '..');

// ---- Configuration (lazy: load .env.local/.env from the repo root on first use,
// because MCP clients typically spawn dist/index.js directly with an empty env) ----
interface GmatConfig {
  gmatBin: string | null;
  gmatConsole: string | null;
  gmatOutput: string | null;
  samplesDir: string | null;
  idiomsPath: string;
}

let cachedConfig: GmatConfig | null = null;

function getConfig(): GmatConfig {
  if (cachedConfig) return cachedConfig;
  dotenv.config({ path: path.join(REPO_ROOT, '.env.local') });
  dotenv.config({ path: path.join(REPO_ROOT, '.env') });

  const gmatBin = process.env.GMAT_BIN || null;
  const exe = os.platform() === 'win32' ? 'GmatConsole.exe' : 'GmatConsole';
  cachedConfig = {
    gmatBin,
    gmatConsole: gmatBin ? path.join(gmatBin, exe) : null,
    gmatOutput: gmatBin ? path.join(gmatBin, '..', 'output') : null,
    samplesDir:
      process.env.GMAT_SAMPLES || (gmatBin ? path.join(gmatBin, '..', 'samples') : null),
    idiomsPath: process.env.GMAT_IDIOMS || path.join(REPO_ROOT, 'data', 'gmat_idioms.md'),
  };
  return cachedConfig;
}

const SETUP_HINT =
  'Set GMAT_BIN to your GMAT bin folder (the one containing GmatConsole) in .env.local at the repo root, or in the MCP server env. See .env.example.';

// ---- Outcome classification (mirrors run_gmat.py) ----
const ERROR_RE =
  /(\*\*\*\*\s*ERROR\s*\*\*\*\*|Interpreter Exception|Could not read script|Execution Failed|did not converge|is not converging|maximum number of iterations|references missing object|not allowed value|outside of the ASCII)/i;
const SUCCESS_RE = /Mission run completed/i;
const CONVERGE_FAIL_RE = /(did not converge|is not converging|maximum number of iterations)/i;

export interface GmatResult {
  ok: boolean;
  stage: 'completed' | 'parse' | 'convergence' | 'run' | 'setup';
  returncode: number | null;
  errors: string[];
  reports: Record<string, string>;
  raw_tail: string;
}

// Benign plugin-load notices GMAT prints at startup (e.g. "*** Library libMatlabInterface
// did not open."). Filter only these, not any line that merely mentions "Library".
const BENIGN_NOTICE_RE = /Library\b.*did not open|did not open.*\bLibrary/i;

function readReports(scriptText: string, notBeforeMs: number): Record<string, string> {
  const { gmatBin, gmatOutput } = getConfig();
  if (!gmatBin || !gmatOutput) return {};
  const reports: Record<string, string> = {};
  const re = /\.Filename\s*=\s*'([^']+)'/g;
  const dirs = [gmatOutput, path.join(gmatBin, 'output'), gmatBin];
  let m: RegExpExecArray | null;
  while ((m = re.exec(scriptText)) !== null) {
    const name = path.basename(m[1]);
    for (const d of dirs) {
      const p = path.join(d, name);
      try {
        if (!fs.existsSync(p)) continue;
        // Only return reports written by THIS run; a file older than the run start
        // is a leftover from a previous run (the current one failed before writing).
        if (fs.statSync(p).mtimeMs < notBeforeMs - 2000) {
          reports[name] = `[stale: file predates this run - the run did not (re)write it]`;
        } else {
          reports[name] = fs.readFileSync(p, 'utf8').slice(0, 8000);
        }
        break;
      } catch {
        /* ignore */
      }
    }
  }
  return reports;
}

interface ProcOutcome {
  stdout: string;
  stderr: string;
  status: number | null;
  timedOut: boolean;
  spawnError?: string;
}

const MAX_CAPTURE = 32 * 1024 * 1024;

// Async spawn so a long GMAT run doesn't block the MCP server's event loop
// (spawnSync froze the whole server - no pings, no other tool calls - for up to 10 min).
function runConsole(args: string[], timeoutMs: number): Promise<ProcOutcome> {
  const { gmatBin, gmatConsole } = getConfig();
  return new Promise((resolve) => {
    const child = spawn(gmatConsole!, args, { cwd: gmatBin! });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
      // On Windows kill() may not take down GmatConsole promptly; force it.
      setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } }, 3000);
    }, timeoutMs);

    child.stdout.on('data', (d) => {
      stdout += d;
      if (stdout.length > MAX_CAPTURE) stdout = stdout.slice(-MAX_CAPTURE / 2);
    });
    child.stderr.on('data', (d) => {
      stderr += d;
      if (stderr.length > MAX_CAPTURE) stderr = stderr.slice(-MAX_CAPTURE / 2);
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, status: null, timedOut, spawnError: String(err) });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, status: code, timedOut });
    });
  });
}

/** Run a GMAT mission script (text) headless and classify the outcome. */
export async function runGmat(scriptText: string, timeoutMs = 600000): Promise<GmatResult> {
  const { gmatConsole } = getConfig();
  if (!gmatConsole) {
    return { ok: false, stage: 'setup', returncode: null, errors: [`GMAT_BIN is not configured. ${SETUP_HINT}`], reports: {}, raw_tail: '' };
  }
  if (!fs.existsSync(gmatConsole)) {
    return { ok: false, stage: 'setup', returncode: null, errors: [`GmatConsole not found at ${gmatConsole}. ${SETUP_HINT}`], reports: {}, raw_tail: '' };
  }

  const tmp = path.join(os.tmpdir(), `mcp_gmat_${Date.now()}.script`);
  fs.writeFileSync(tmp, scriptText, 'utf8');
  const startMs = Date.now();

  const proc = await runConsole([tmp], timeoutMs);
  try { fs.unlinkSync(tmp); } catch { /* ignore */ }

  const raw = `${proc.stdout || ''}\n${proc.stderr || ''}`;
  const lines = raw.split(/\r?\n/);

  if (proc.timedOut) {
    // Return the partial output - it shows exactly where GMAT hung (e.g. which solver loop).
    return {
      ok: false,
      stage: 'run',
      returncode: null,
      errors: [`GMAT run exceeded ${Math.round(timeoutMs / 1000)}s (propagation too long / hang). Partial output in raw_tail.`],
      reports: readReports(scriptText, startMs),
      raw_tail: lines.slice(-60).join('\n'),
    };
  }
  if (proc.spawnError) {
    return { ok: false, stage: 'setup', returncode: null, errors: [`Failed to launch GmatConsole: ${proc.spawnError}`], reports: {}, raw_tail: '' };
  }

  const errors = lines
    .map((l) => l.trim())
    .filter((l) => ERROR_RE.test(l))
    .filter((l) => !BENIGN_NOTICE_RE.test(l));

  const convergedFail = lines.some((l) => CONVERGE_FAIL_RE.test(l));
  const success = lines.some((l) => SUCCESS_RE.test(l));
  const parseFail = errors.some((e) =>
    /could not read script|interpreter exception|references missing object|outside of the ascii/i.test(e)
  );

  const rc = proc.status;
  const ok = success && errors.length === 0 && (rc === 0 || rc === null);
  let stage: GmatResult['stage'];
  if (ok) stage = 'completed';
  else if (convergedFail) stage = 'convergence';
  else if (parseFail) stage = 'parse';
  else stage = 'run';

  return {
    ok,
    stage,
    returncode: rc,
    errors: errors.slice(0, 25),
    reports: readReports(scriptText, startMs),
    raw_tail: lines.slice(-40).join('\n'),
  };
}

/** The curated GMAT idioms / gotchas knowledge base. */
export function getIdioms(): string {
  const { idiomsPath } = getConfig();
  try {
    return fs.readFileSync(idiomsPath, 'utf8');
  } catch {
    return `Idioms file not found at ${idiomsPath} (set GMAT_IDIOMS).`;
  }
}

/** List the available NASA sample .script files (top level of the samples dir). */
export function listSamples(): string[] {
  const { samplesDir } = getConfig();
  if (!samplesDir) return [];
  try {
    return fs
      .readdirSync(samplesDir)
      .filter((f) => f.toLowerCase().endsWith('.script'))
      .sort();
  } catch {
    return [];
  }
}

/** Return the text of one sample script by file name. */
export function getSample(name: string): string {
  const { samplesDir } = getConfig();
  if (!samplesDir) return `Samples dir not configured. ${SETUP_HINT}`;
  const safe = path.basename(name);
  const p = path.join(samplesDir, safe);
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return `Sample not found: ${safe} (looked in ${samplesDir}). Use listGmatSamples to see options.`;
  }
}
