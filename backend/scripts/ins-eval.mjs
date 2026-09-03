#!/usr/bin/env node
/**
 * ins-eval.mjs — score Elena's insurance/benefits answers against the team's
 * own recorded determinations.
 *
 * There is no reviewInsurance() to call: the benefits decision lives in Elena's
 * chat, not in a dedicated endpoint. So this drives the DEPLOYED Elena through
 * /api/chat and grades what she says.
 *
 * Two modes, and they measure different things:
 *
 *   RETRIEVAL (default) — names a real patient and asks what their benefits
 *     determination is. She can look them up in Monday, so this tests whether
 *     she can find and correctly report recorded state. It is the regression
 *     test for the column-map bugs: before the per-board column fixes, the
 *     Profile board's Primary Insurance column read blank for every patient.
 *
 *   --blind — names only a payer and a product, never a patient, so there is
 *     nothing to look up. This tests whether she actually knows the payer
 *     rules. Expect this to score badly until a payer rules table is added to
 *     her knowledge base: the SOP refers to "the payer rules tables" but no
 *     such table exists in the repo, so today she has nothing to answer from.
 *
 * The answer key is derived from the boards, not hand-written: for each
 * payer x product we take the recorded values across every patient and keep the
 * pair ONLY when the team has been unanimous and has at least --min-support
 * patients behind it. Anything contested is reported and excluded rather than
 * guessed at — an inconsistent pair is a data-quality finding, not a test case.
 *
 * Usage:
 *   node scripts/ins-eval.mjs --table                 # just print the derived rules
 *   node scripts/ins-eval.mjs --limit 5               # retrieval mode, 5 patients
 *   node scripts/ins-eval.mjs --blind                 # payer-rule knowledge
 *   node scripts/ins-eval.mjs --blind --min-support 5
 *
 * Env:
 *   MONDAY_API_TOKEN  — required
 *   ELENA_PORTAL_KEY  — required (x-portal-key auth bypass on the deployed API)
 *   ELENA_API_URL     — override the API base (default: production)
 */

import fs from 'node:fs/promises';

const API = process.env.ELENA_API_URL || 'https://elena-backend-production.up.railway.app/api';
const PROFILE_BOARD = 18406352652;

const PAYER_COL = 'color_mm1xg10n';   // Profile board's own Primary Insurance
const SERVING_COL = 'color_mm1w1cm9';

/** The per-product benefits determinations the team records on the Profile board. */
const PRODUCTS = [
  { key: 'monitor',    label: 'CGM monitor/reader', authReq: 'color_mm2bpw7z', network: 'color_mm2bekxa', hcpc: 'color_mm2b1zgq' },
  { key: 'sensors',    label: 'CGM sensors',        authReq: 'color_mm2bscj',  network: 'color_mm2brh0x', hcpc: 'color_mm2b6t98' },
  { key: 'insulinPump',label: 'insulin pump',       authReq: 'color_mm2bx2ys', network: 'color_mm2b91nc', hcpc: 'color_mm2bjwvx' },
  { key: 'infusionSet',label: 'infusion sets',      authReq: 'color_mm2btvq0', network: 'color_mm2b1ver', hcpc: 'color_mm2bpvvy' },
  { key: 'cartridge',  label: 'cartridges',         authReq: 'color_mm2bd0q0', network: 'color_mm2bm7g8', hcpc: 'color_mm2bxxz2' },
];

/** Values that mean "nobody has decided yet" — never an answer key. */
const UNDECIDED = new Set(['', 'Evaluate', 'Not Serving']);

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

/** Every Profile-board patient carrying a benefits determination, all pages. */
async function loadPatients() {
  const ids = [PAYER_COL, SERVING_COL, ...PRODUCTS.flatMap(p => [p.authReq, p.network, p.hcpc])]
    .map(id => `"${id}"`).join(', ');
  const out = [];
  let cursor = null;

  for (;;) {
    const page = cursor
      ? `next_items_page(limit: 500, cursor: "${cursor}")`
      : `boards(ids: ${PROFILE_BOARD}) { items_page(limit: 500)`;
    const body = `cursor items { id name group { title } column_values(ids: [${ids}]) { id text } }`;
    const data = await monday(cursor ? `{ ${page} { ${body} } }` : `{ ${page} { ${body} } } }`);
    const pageData = cursor ? data.next_items_page : data.boards?.[0]?.items_page;

    for (const item of pageData?.items || []) {
      const payer = colText(item, PAYER_COL);
      if (!payer) continue;
      const rec = { id: item.id, name: item.name, group: item.group.title, payer, serving: colText(item, SERVING_COL), products: {} };
      let anyDecided = false;
      for (const p of PRODUCTS) {
        const authReq = colText(item, p.authReq);
        const network = colText(item, p.network);
        const hcpc = colText(item, p.hcpc);
        rec.products[p.key] = { authReq, network, hcpc };
        if (!UNDECIDED.has(authReq) || !UNDECIDED.has(network)) anyDecided = true;
      }
      if (anyDecided) out.push(rec);
    }
    cursor = pageData?.cursor || null;
    if (!cursor) return out;
  }
}

/**
 * Derive the payer x product answer key from what the team actually recorded.
 * Keeps only unanimous pairs with enough support; reports contested ones.
 */
function deriveRules(patients, minSupport) {
  const tally = {};   // payer -> product -> field -> value -> count
  for (const pt of patients) {
    for (const p of PRODUCTS) {
      const v = pt.products[p.key];
      for (const field of ['authReq', 'network', 'hcpc']) {
        if (UNDECIDED.has(v[field])) continue;
        (((tally[pt.payer] ||= {})[p.key] ||= {})[field] ||= {});
        tally[pt.payer][p.key][field][v[field]] = (tally[pt.payer][p.key][field][v[field]] || 0) + 1;
      }
    }
  }

  const rules = [];
  const contested = [];
  for (const [payer, byProduct] of Object.entries(tally)) {
    for (const [productKey, byField] of Object.entries(byProduct)) {
      for (const [field, counts] of Object.entries(byField)) {
        const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        const total = entries.reduce((n, [, c]) => n + c, 0);
        if (entries.length > 1) {
          contested.push({ payer, productKey, field, spread: entries.map(([v, c]) => `${v}:${c}`).join(' / ') });
          continue;
        }
        if (total < minSupport) continue;
        rules.push({ payer, productKey, field, value: entries[0][0], support: total });
      }
    }
  }
  return { rules, contested };
}

async function askElena(message, conversationId) {
  const key = process.env.ELENA_PORTAL_KEY;
  if (!key) throw new Error('ELENA_PORTAL_KEY is not set');
  const resp = await fetch(`${API}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-portal-key': key },
    body: JSON.stringify({ message, conversationId }),
  });
  if (!resp.ok) throw new Error(`Elena API ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  return resp.json();
}

/**
 * Read a yes/no/INN/OON/HCPC answer out of Elena's prose. Deliberately strict:
 * if she hedges without committing, that counts as no answer, not a wrong one —
 * "she didn't answer" and "she answered wrong" are different failures.
 */
function extractAnswer(field, text, productLabel) {
  const t = text.toLowerCase();
  // Narrow to the sentence(s) mentioning this product where possible.
  const head = productLabel.split(/[ /]/)[0].toLowerCase();
  const scoped = t.split(/[.\n]/).filter(s => s.includes(head)).join('. ') || t;

  if (field === 'authReq') {
    // Split into clauses and judge each one's polarity. Matching "required" and
    // "not required" with two competing regexes is unreliable — "do not require
    // a prior auth" satisfies both — and a false Yes is the expensive error.
    const clauses = scoped.split(/[;,.]|\band\b/).filter(c => /auth|require/.test(c));
    if (!clauses.length) return null;
    let yes = 0, no = 0;
    for (const c of clauses) {
      if (/\b(no|not|never|without|none|n't)\b/.test(c)) no++;
      else yes++;
    }
    if (yes && !no) return 'Yes';
    if (no && !yes) return 'No';
    return null;   // mixed or hedged — treat as "did not commit", not as wrong
  }
  if (field === 'network') {
    const inn = /\binn\b|in[- ]network/.test(scoped);
    const oon = /\boon\b|out[- ]of[- ]network/.test(scoped);
    if (/borrowed network/.test(scoped)) return 'Borrowed Network';
    if (inn && !oon) return 'INN';
    if (oon && !inn) return 'OON';
    return null;
  }
  if (field === 'hcpc') {
    const m = scoped.match(/\b([aeklv]\d{4})\b/i);
    return m ? m[1].toUpperCase() : null;
  }
  return null;
}

const FIELD_LABEL = { authReq: 'prior auth required?', network: 'network status', hcpc: 'HCPC code' };

function parseArgs(argv) {
  const o = { blind: false, limit: 5, minSupport: 3, table: false, json: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--blind') o.blind = true;
    else if (argv[i] === '--table') o.table = true;
    else if (argv[i] === '--limit') o.limit = Number(argv[++i]);
    else if (argv[i] === '--min-support') o.minSupport = Number(argv[++i]);
    else if (argv[i] === '--json') o.json = argv[++i];
  }
  return o;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  console.log('Loading Profile-board benefits determinations from Monday...');
  const patients = await loadPatients();
  const { rules, contested } = deriveRules(patients, opts.minSupport);
  console.log(`  ${patients.length} patients with a recorded determination`);
  console.log(`  ${rules.length} payer×product rules unanimous with >=${opts.minSupport} support`);
  console.log(`  ${contested.length} contested (excluded from scoring)\n`);

  if (contested.length) {
    console.log('── CONTESTED (the team has recorded conflicting values — worth a look):');
    for (const c of contested.slice(0, 15)) {
      console.log(`   ${c.payer} / ${c.productKey} / ${FIELD_LABEL[c.field]} → ${c.spread}`);
    }
    if (contested.length > 15) console.log(`   ...and ${contested.length - 15} more`);
    console.log();
  }

  if (opts.table) {
    console.log('── DERIVED PAYER RULES');
    const byPayer = {};
    for (const r of rules) (byPayer[r.payer] ||= []).push(r);
    for (const [payer, rs] of Object.entries(byPayer).sort()) {
      console.log(`\n  ${payer}`);
      for (const r of rs.sort((a, b) => a.productKey.localeCompare(b.productKey))) {
        const p = PRODUCTS.find(x => x.key === r.productKey);
        console.log(`    ${p.label.padEnd(20)} ${FIELD_LABEL[r.field].padEnd(22)} ${r.value}   (n=${r.support})`);
      }
    }
    console.log();
    return;
  }

  if (!process.env.ELENA_PORTAL_KEY) {
    console.error('ELENA_PORTAL_KEY is not set — needed to ask the deployed Elena. (--table works without it.)');
    process.exit(1);
  }
  console.log(`Asking Elena at ${API}  [${opts.blind ? 'BLIND — payer rules only' : 'RETRIEVAL — real patients'}]\n`);

  const results = [];

  if (opts.blind) {
    const picked = rules.filter(r => r.field !== 'hcpc').slice(0, opts.limit);
    for (const r of picked) {
      const p = PRODUCTS.find(x => x.key === r.productKey);
      const q = r.field === 'authReq'
        ? `For a patient with ${r.payer} as their primary insurance, do we need a prior authorization for ${p.label}? Answer yes or no.`
        : `For a patient with ${r.payer} as their primary insurance, are we in-network or out-of-network for ${p.label}? Answer INN or OON.`;
      console.log(`━━━ ${r.payer} — ${p.label} — ${FIELD_LABEL[r.field]}`);
      console.log(`    Q: ${q}`);
      const { message } = await askElena(q);
      const got = extractAnswer(r.field, message, p.label);
      const verdict = got === null ? 'NO ANSWER' : got === r.value ? 'CORRECT' : 'WRONG';
      console.log(`    Elena: ${got ?? '(did not commit)'}   Team: ${r.value} (n=${r.support})   → ${verdict}`);
      console.log(`    "${message.replace(/\s+/g, ' ').slice(0, 220)}..."\n`);
      results.push({ mode: 'blind', ...r, product: p.label, asked: q, answer: message, got, verdict });
    }
  } else {
    // Retrieval: pick patients with the most decided fields, so each question is dense.
    const scored = patients
      .map(pt => ({ pt, n: PRODUCTS.filter(p => !UNDECIDED.has(pt.products[p.key].authReq)).length }))
      .filter(x => x.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, opts.limit);

    for (const { pt } of scored) {
      const live = PRODUCTS.filter(p => !UNDECIDED.has(pt.products[p.key].authReq));
      const q = `For the patient ${pt.name}: for each of ${live.map(p => p.label).join(', ')}, `
              + `does it need a prior authorization, and what is the network status? `
              + `Give one line per product. If you cannot find the patient or the field, say so — do not guess.`;
      console.log(`━━━ ${pt.name}  (${pt.payer}, ${pt.group})`);
      const { message } = await askElena(q);

      for (const p of live) {
        for (const field of ['authReq', 'network']) {
          const expected = pt.products[p.key][field];
          if (UNDECIDED.has(expected)) continue;
          const got = extractAnswer(field, message, p.label);
          const verdict = got === null ? 'NO ANSWER' : got === expected ? 'CORRECT' : 'WRONG';
          console.log(`    ${p.label.padEnd(20)} ${FIELD_LABEL[field].padEnd(22)} Elena=${String(got ?? '—').padEnd(18)} team=${expected.padEnd(18)} ${verdict}`);
          results.push({ mode: 'retrieval', patient: pt.name, payer: pt.payer, product: p.label, field, expected, got, verdict });
        }
      }
      console.log(`    "${message.replace(/\s+/g, ' ').slice(0, 220)}..."\n`);
    }
  }

  const n = results.length;
  const correct = results.filter(r => r.verdict === 'CORRECT').length;
  const wrong = results.filter(r => r.verdict === 'WRONG').length;
  const noAnswer = results.filter(r => r.verdict === 'NO ANSWER').length;
  console.log('═══ SUMMARY');
  console.log(`  correct   : ${correct}/${n}`);
  console.log(`  wrong     : ${wrong}/${n}   ${wrong ? '(confidently wrong — the expensive kind)' : ''}`);
  console.log(`  no answer : ${noAnswer}/${n}  ${noAnswer ? '(declined to commit — safe, but not useful)' : ''}`);

  if (opts.json) {
    await fs.writeFile(opts.json, JSON.stringify(results, null, 2));
    console.log(`\nWrote ${opts.json} (contains patient names — do not commit)`);
  }
}

export { deriveRules, extractAnswer, PRODUCTS, UNDECIDED };

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(err); process.exit(1); });
}
