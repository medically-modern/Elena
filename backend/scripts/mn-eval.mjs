#!/usr/bin/env node
/**
 * mn-eval.mjs — score Elena's Medical Necessity evaluation against the team's
 * own recorded decisions.
 *
 * For each patient it pulls the real clinical files off the Medical Evaluation
 * board, runs them through the SAME reviewDocuments() call the app uses, and
 * prints Elena's determination beside the determination Masheke's team already
 * recorded in Monday (the MN Invalid Reasons dropdowns). Those dropdowns are
 * line-level, so this is a real comparison, not a vibe check.
 *
 * Usage:
 *   node scripts/mn-eval.mjs "Priscilla McDowell" "Keigen Kelusak"
 *   node scripts/mn-eval.mjs --substage "Evaluate MN" --limit 3
 *   node scripts/mn-eval.mjs --substage "Chase Clinicals" --limit 5 --json out.json
 *
 * Two ways to reach Elena:
 *   --api            drive the DEPLOYED Elena over her own HTTP API (preferred:
 *                    she already holds the model key, so you only need the
 *                    portal key). Defaults to the production backend.
 *   --local          import reviewDocuments() in-process (needs ANTHROPIC_API_KEY).
 *
 * Env:
 *   MONDAY_API_TOKEN  — always required
 *   ELENA_PORTAL_KEY  — required in --api mode (the x-portal-key auth bypass)
 *   ELENA_API_URL     — override the API base (default: production)
 *   ANTHROPIC_API_KEY — required only in --local mode
 *
 * Note: this downloads real PHI into a temp directory and deletes it on exit.
 * Do not point --json at anything that gets committed.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_API = process.env.ELENA_API_URL || 'https://elena-backend-production.up.railway.app/api';

/** Ask the deployed Elena to review the documents, through her own endpoint. */
async function reviewViaApi(pdfs, message, apiBase) {
  const key = process.env.ELENA_PORTAL_KEY;
  if (!key) throw new Error('ELENA_PORTAL_KEY is not set (needed to authenticate against the deployed Elena)');
  const resp = await fetch(`${apiBase}/evaluate/document`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-portal-key': key },
    body: JSON.stringify({ pdfs, message }),
  });
  if (!resp.ok) throw new Error(`Elena API ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  return resp.json();
}

/** Lazily import the in-process path so --api mode needs no Anthropic key. */
async function reviewLocally(pdfs, message) {
  const { reviewDocuments } = await import('../src/services/medical-necessity.js');
  return reviewDocuments(pdfs, message);
}

const MN_BOARD = 18406060017;
const MN_GROUP = 'group_mm1xf2jb';

/** Columns that carry the team's recorded determination. */
const TRUTH_COLUMNS = {
  subStage:        'color_mm1wyr92',
  medicalNecessity:'color_mm1y6qrf',
  generalReasons:  'dropdown_mm2xppn8',
  cgmReasons:      'dropdown_mm2xncfh',
  ipReasons:       'dropdown_mm2xgg2y',
  requested:       'dropdown_mm2yd3a2',
  serving:         'color_mm1w1cm9',
  cgmPath:         'color_mm1w7e5q',
  ipPath:          'color_mm1w5xn1',
  lastVisit:       'date_mm1wb9br',
  attempts:        'numeric_mm4bhjc8',
};

// Documents that are demographics/orders rather than clinical notes. Kept, but
// flagged, because "we only had a facesheet" is itself a finding.
const NON_CLINICAL_HINT = /facesheet|script template|service_registration|registration form|ins card|insurance[-_ ]?card/i;

async function monday(query) {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) throw new Error('MONDAY_API_TOKEN is not set');
  const resp = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json', 'API-Version': '2024-10' },
    body: JSON.stringify({ query }),
  });
  if (!resp.ok) throw new Error(`Monday HTTP ${resp.status}: ${await resp.text()}`);
  const json = await resp.json();
  if (json.errors?.length) throw new Error(`Monday GraphQL: ${json.errors.map(e => e.message).join('; ')}`);
  return json.data;
}

const colText = (item, id) => item.column_values.find(c => c.id === id)?.text || '';

/** Every patient in the Medical Necessity group, with their recorded decision. */
async function loadCases() {
  const ids = Object.values(TRUTH_COLUMNS).map(id => `"${id}"`).join(', ');
  const cases = [];
  let cursor = null;

  for (;;) {
    const page = cursor
      ? `next_items_page(limit: 500, cursor: "${cursor}")`
      : `boards(ids: ${MN_BOARD}) { items_page(limit: 500, query_params: { rules: [{ column_id: "group", compare_value: ["${MN_GROUP}"] }] })`;
    const body = `cursor items { id name column_values(ids: [${ids}]) { id text } assets { id name file_extension file_size public_url } }`;
    const data = await monday(cursor ? `{ ${page} { ${body} } }` : `{ ${page} { ${body} } } }`);
    const pageData = cursor ? data.next_items_page : data.boards?.[0]?.items_page;

    for (const item of pageData?.items || []) {
      const truth = {};
      for (const [field, id] of Object.entries(TRUTH_COLUMNS)) truth[field] = colText(item, id);
      cases.push({ id: item.id, name: item.name, truth, assets: item.assets || [] });
    }
    cursor = pageData?.cursor || null;
    if (!cursor) return cases;
  }
}

async function fetchPdfs(assets, dir) {
  const pdfs = [];
  for (const a of assets) {
    if ((a.file_extension || '').toLowerCase() !== '.pdf') continue;
    const resp = await fetch(a.public_url);
    if (!resp.ok) {
      console.warn(`    ! could not download ${a.name} (HTTP ${resp.status})`);
      continue;
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    await fs.writeFile(path.join(dir, a.name.replace(/[^\w.\-]/g, '_')), buf);
    pdfs.push({ filename: a.name, base64: buf.toString('base64') });
  }
  return pdfs;
}

/**
 * Compare Elena's rows to the team's recorded reasons. The dropdowns are short
 * canonical phrases ("MR Missing", "CGM Script invalid"), so we check whether
 * Elena raised something about the same subject rather than demanding identical
 * wording — and report the ones she MISSED, which is what actually matters.
 */
export const TOPIC_PATTERNS = [
  { truth: /MR Missing/i,            elena: /medical record|chart note|office visit|progress note|clinical/i, label: 'Medical records missing' },
  { truth: /MR Expired/i,            elena: /expir|stale|more than 6 months|older than six|out of date|last visit/i, label: 'Medical records expired (>6mo)' },
  { truth: /Diagnosis missing/i,     elena: /diagnos/i,                                    label: 'Qualifying diagnosis missing' },
  { truth: /CGM Script missing/i,    elena: /cgm.*(script|order)|(script|order).*cgm|document (not )?present|no order/i, label: 'CGM script missing' },
  { truth: /CGM Script invalid/i,    elena: /invalid|incomplete|unsigned|stale|expired|inconsisten|wear time|quantity/i, label: 'CGM script invalid' },
  { truth: /Insulin Pump Script (missing|invalid)/i, elena: /pump.*(script|order)|(script|order).*pump/i, label: 'Pump script missing/invalid' },
  { truth: /Insulin language/i,      elena: /insulin/i,                                    label: 'Insulin language' },
];

export function score(evaluation, truth) {
  const truthText = [truth.generalReasons, truth.cgmReasons, truth.ipReasons].filter(Boolean).join('; ');
  const elenaText = [
    evaluation.gap_note || '',
    ...(evaluation.rows || []).map(r => `${r.requirement} ${r.decision} ${r.evidence} ${r.rule}`),
  ].join(' ');

  const expected = TOPIC_PATTERNS.filter(t => t.truth.test(truthText));
  const caught = expected.filter(t => t.elena.test(elenaText));
  const missed = expected.filter(t => !t.elena.test(elenaText));

  const truthVerdict = /^Established$/i.test(truth.medicalNecessity) ? 'Established' : 'Not established';
  return {
    verdictMatch: (evaluation.verdict || '') === truthVerdict,
    truthVerdict,
    expected: expected.map(t => t.label),
    caught: caught.map(t => t.label),
    missed: missed.map(t => t.label),
  };
}

function parseArgs(argv) {
  const opts = { names: [], subStage: null, limit: null, json: null, local: false, api: DEFAULT_API };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--substage') opts.subStage = argv[++i];
    else if (argv[i] === '--limit') opts.limit = Number(argv[++i]);
    else if (argv[i] === '--json') opts.json = argv[++i];
    else if (argv[i] === '--local') opts.local = true;
    else if (argv[i] === '--api') { if (argv[i + 1] && !argv[i + 1].startsWith('--')) opts.api = argv[++i]; }
    else opts.names.push(argv[i]);
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.local && !process.env.ANTHROPIC_API_KEY) {
    console.error('--local needs ANTHROPIC_API_KEY. Drop --local to drive the deployed Elena with ELENA_PORTAL_KEY instead.');
    process.exit(1);
  }
  if (!opts.local && !process.env.ELENA_PORTAL_KEY) {
    console.error('ELENA_PORTAL_KEY is not set — needed to authenticate against the deployed Elena. (Or pass --local with ANTHROPIC_API_KEY.)');
    process.exit(1);
  }
  console.log(opts.local ? 'Mode: in-process reviewDocuments()' : `Mode: deployed Elena at ${opts.api}`);

  console.log('Loading Medical Necessity cases from Monday...');
  const all = await loadCases();
  console.log(`  ${all.length} patients in the Medical Necessity group\n`);

  let selected = all;
  if (opts.names.length) {
    selected = opts.names
      .map(n => all.find(c => c.name.toLowerCase() === n.toLowerCase())
             || all.find(c => c.name.toLowerCase().includes(n.toLowerCase())))
      .filter(Boolean);
    const missing = opts.names.filter(n => !selected.some(c => c.name.toLowerCase().includes(n.toLowerCase())));
    if (missing.length) console.warn(`  ! not found: ${missing.join(', ')}\n`);
  } else if (opts.subStage) {
    selected = all.filter(c => c.truth.subStage === opts.subStage);
  }
  // Only cases that actually have a recorded decision AND documents to read.
  selected = selected.filter(c =>
    c.assets.some(a => (a.file_extension || '').toLowerCase() === '.pdf'));
  if (opts.limit) selected = selected.slice(0, opts.limit);

  if (!selected.length) {
    console.error('No cases matched (need at least one PDF on the item).');
    process.exit(1);
  }

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mn-eval-'));
  const results = [];

  try {
    for (const c of selected) {
      console.log(`━━━ ${c.name}  (item ${c.id})`);
      console.log(`    sub-stage: ${c.truth.subStage || '—'}   serving: ${c.truth.serving || '—'}   CGM path: ${c.truth.cgmPath || '—'}   attempt #${c.truth.attempts || '?'}`);

      const caseDir = path.join(tmp, c.id);
      await fs.mkdir(caseDir, { recursive: true });
      const pdfs = await fetchPdfs(c.assets, caseDir);
      const flagged = pdfs.filter(p => NON_CLINICAL_HINT.test(p.filename)).map(p => p.filename);
      console.log(`    ${pdfs.length} PDF(s)${flagged.length ? ` — ${flagged.length} look non-clinical: ${flagged.join(', ')}` : ''}`);

      if (!pdfs.length) { console.log('    skipped: no readable PDFs\n'); continue; }

      const instruction = 'Run a full Medical Necessity evaluation on these documents and submit the structured result.';
      const evaluation = opts.local
        ? await reviewLocally(pdfs, instruction)
        : await reviewViaApi(pdfs, instruction, opts.api);

      if (evaluation.type !== 'mn-evaluation') {
        console.log(`    ✗ Elena answered in prose instead of calling submit_mn_evaluation:\n      ${(evaluation.text || '').slice(0, 300)}\n`);
        results.push({ name: c.name, id: c.id, error: 'no structured evaluation', truth: c.truth });
        continue;
      }

      const s = score(evaluation, c.truth);
      console.log(`\n    ELENA : ${evaluation.verdict}  (${evaluation.product || '?'} / ${evaluation.coverage_path || '?'})`);
      console.log(`            ${evaluation.gap_note || '(no gap note)'}`);
      console.log(`    TEAM  : ${s.truthVerdict}`);
      console.log(`            general: ${c.truth.generalReasons || '—'}`);
      console.log(`            cgm:     ${c.truth.cgmReasons || '—'}`);
      console.log(`            ip:      ${c.truth.ipReasons || '—'}`);
      console.log(`            asked for: ${c.truth.requested || '—'}`);
      console.log(`\n    verdict match: ${s.verdictMatch ? 'YES' : 'NO'}`);
      if (s.expected.length) {
        console.log(`    caught: ${s.caught.length}/${s.expected.length}${s.missed.length ? `   MISSED: ${s.missed.join(', ')}` : ''}`);
      }
      console.log(`    rows: ${(evaluation.rows || []).map(r => `${r.requirement}=${r.decision}`).join(', ')}\n`);

      results.push({ name: c.name, id: c.id, elena: evaluation, truth: c.truth, score: s });
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }

  const scored = results.filter(r => r.score);
  if (scored.length) {
    const verdictHits = scored.filter(r => r.score.verdictMatch).length;
    const expected = scored.reduce((n, r) => n + r.score.expected.length, 0);
    const caught = scored.reduce((n, r) => n + r.score.caught.length, 0);
    console.log('═══ SUMMARY');
    console.log(`  verdict agreement : ${verdictHits}/${scored.length}`);
    console.log(`  reasons caught    : ${caught}/${expected}`);
    const allMissed = scored.flatMap(r => r.score.missed);
    if (allMissed.length) {
      const counts = allMissed.reduce((m, l) => (m[l] = (m[l] || 0) + 1, m), {});
      console.log(`  most-missed       : ${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l} (${n})`).join(', ')}`);
    }
  }

  if (opts.json) {
    await fs.writeFile(opts.json, JSON.stringify(results, null, 2));
    console.log(`\nWrote ${opts.json} (contains PHI — do not commit)`);
  }
}

// Only run when invoked directly, so the scorer can be imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(err); process.exit(1); });
}
