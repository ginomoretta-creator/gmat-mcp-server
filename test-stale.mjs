// Verify the stale-report guard: this script names the same report file as the
// good smoke run but fails at parse, so the old file on disk must be flagged stale.
import { runGmat } from './dist/utils/gmat.js';

const s = [
  'Create Spacecraft Sat;',
  'Create ReportFile Rep;',
  "Rep.Filename = 'smoke_report.txt';",
  'BeginMissionSequence;',
  'Propagate BadProp(Sat) {Sat.ElapsedSecs = 60};',
].join('\n');

const r = await runGmat(s, 60000);
console.log('ok:', r.ok, '| stage:', r.stage);
console.log('errors:', r.errors.slice(0, 2));
console.log('report value:', JSON.stringify(r.reports['smoke_report.txt'] ?? '(none)').slice(0, 140));
