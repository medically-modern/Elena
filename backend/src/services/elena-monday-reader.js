/**
 * elena-monday-reader.js
 *
 * Read-only Monday.com service for Elena's LLM backend.
 * Gives Elena access to Command Center data across all five pipeline boards
 * without any write capability.
 *
 * Usage:
 *   import { searchPatient, getPatient, getBoardGroupPatients, getUiState, explainField } from './elena-monday-reader.js';
 *
 * Env:
 *   MONDAY_API_TOKEN — Monday.com API v2 token
 */

// ─── Configuration ──────────────────────────────────────────────────────────────

const MONDAY_API_URL = 'https://api.monday.com/v2';
const MONDAY_API_VERSION = '2024-10';

function getApiToken() {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) {
    throw new Error('MONDAY_API_TOKEN environment variable is not set');
  }
  return token;
}

// ─── Board Definitions ──────────────────────────────────────────────────────────

/** @type {Record<string, number>} */
export const BOARD_IDS = {
  medical_necessity: 18406060017,
  insurance:         18410601299,
  welcome_call:      18410804557,
  profile:           18406352652,
  subscription:      18407459988,
};

/** @type {Record<string, string>} Board ID (as string) to human-readable name */
export const BOARD_NAMES = {
  '18406060017': 'Medical Necessity (Masheke)',
  '18410601299': 'Insurance & Benefits (Samantha)',
  '18410804557': 'Welcome Call + Final Confirm',
  '18406352652': 'Profile Checklist',
  '18407459988': 'Subscription',
};

/**
 * Board ID → { groupAlias: groupId }.
 *
 * NOTE: Monday group IDs are NOT globally unique — the same ID is reused across
 * boards (e.g. `group_mm1xf2jb` is "1. Intake" on Profile AND "2. Medical
 * Necessity" on Medical Evaluation; `group_mm1xyczx` is "Stuck" on three
 * boards). Always resolve a group with its board, never by ID alone.
 *
 * @type {Record<number, Record<string, string>>}
 */
export const BOARD_GROUPS = {
  18406060017: {
    medicalNecessity: 'group_mm1xf2jb',
    completed:        'group_mm1x5q4e',
    stuck:            'group_mm1xyczx',
    escalations:      'group_mm33pdpm',
  },
  18410601299: {
    benefits:        'group_mm1xr3q3',
    submitAuth:      'group_mm1x1416',
    authOutstanding: 'group_mm2v6d1z',
    dvs:             'group_mm5gp2r2',
    authDenied:      'group_mm316hg2',
    escalations:     'group_mm2vg9gn',
    complete:        'group_mm2vw3c0',
    stuck:           'group_mm5g7twt',
  },
  18410804557: {
    welcomeCall:              'group_mm1wvq8p',
    finalProfileConfirmation: 'group_mm2x8jtj',
    completed:                'group_mm1x5s5d',
    stuck:                    'group_mm1xyczx',
    escalation:               'group_mm1x5c0',
  },
  18406352652: {
    intake:              'group_mm1xf2jb',
    alreadyInSystem:     'group_mm64b83h',
    newFormPartialLeads: 'group_mm5z87zt',
    newFormCompleted:    'group_mm5zgeak',
    profileCleanUp:      'group_mm6c3rhb',
    tests:               'group_mm1wvq8p',
    archivedDtcs:        'group_mm4vhqff',
    stuck:               'group_mm1xyczx',
    completed:           'group_mm1y57sz',
  },
  18407459988: {
    subscriptions: 'topics',
    notActive:     'group_mkp19fyp',
  },
};

/**
 * The groups that make up the LIVE pipeline, in stage order. Anything not on
 * this list (Completed, Stuck, Escalations, Archived, partial form leads) is
 * NOT an active pipeline patient.
 * @type {Array<{stage: string, boardId: number, groupAlias: string}>}
 */
export const ACTIVE_PIPELINE = [
  { stage: 'Intake',                     boardId: 18406352652, groupAlias: 'intake' },
  { stage: 'Medical Necessity',          boardId: 18406060017, groupAlias: 'medicalNecessity' },
  { stage: 'Benefits',                   boardId: 18410601299, groupAlias: 'benefits' },
  { stage: 'Submit Auth',                boardId: 18410601299, groupAlias: 'submitAuth' },
  { stage: 'Auth Outstanding',           boardId: 18410601299, groupAlias: 'authOutstanding' },
  { stage: 'Welcome Call',               boardId: 18410804557, groupAlias: 'welcomeCall' },
  { stage: 'Final Profile Confirmation', boardId: 18410804557, groupAlias: 'finalProfileConfirmation' },
];

/**
 * Reverse lookup keyed by `${boardId}:${groupId}` — group IDs collide across
 * boards, so keying on the ID alone silently mislabels patients (every Medical
 * Necessity patient used to come back with groupAlias "intake").
 */
const GROUP_REVERSE = {};
for (const [boardId, groups] of Object.entries(BOARD_GROUPS)) {
  for (const [alias, gid] of Object.entries(groups)) {
    GROUP_REVERSE[`${boardId}:${gid}`] = { boardId: Number(boardId), groupAlias: alias };
  }
}

/** Resolve a group alias for an item, scoped to its board. */
function groupAliasFor(boardId, groupId, fallbackTitle) {
  return GROUP_REVERSE[`${boardId}:${groupId}`] || { boardId, groupAlias: fallbackTitle };
}

// ─── Column ID Maps ─────────────────────────────────────────────────────────────

/**
 * Columns shared across most boards.
 *
 * These are the DEFAULTS. Several boards use a different column ID for the same
 * concept, or don't have the column at all — see BOARD_COLUMN_OVERRIDES. Monday
 * silently drops unknown column IDs from a query rather than erroring, so a
 * stale ID here shows up as a permanently blank field, never as a failure.
 * Always go through resolveColumns(boardId).
 */
export const SHARED_COLUMNS = {
  dob:               'text_mm1xvxst',
  phone:             'phone_mm1x44yk',
  address:           'location_mm1xhw17',
  primaryInsurance:  'color_mm1x157j',
  memberId1:         'text_mm1x2qk2',
  memberId2:         'text_mm1xaccx',
  serving:           'color_mm1w1cm9',
  doctorName:        'text_mm1x46et',
  diagnosis:         'color_mm1wf7rv',
  daysSinceIntake:   'color_mm1xwabn',
  daysSinceStageStart: 'color_mm1wwm05',
  referralSource:    'color_mm1w5wxr',
  referralType:      'color_mm1wm4n4',
};

/**
 * Per-board corrections to SHARED_COLUMNS. `null` means "this board does not
 * have that column" and the field is dropped from the query entirely.
 * Verified against the live boards.
 * @type {Record<number, Record<string, string|null>>}
 */
export const BOARD_COLUMN_OVERRIDES = {
  // Profile Send Off Board — its own Primary Insurance column, and no
  // diagnosis / days-since columns at all.
  18406352652: {
    primaryInsurance:    'color_mm1xg10n',
    diagnosis:           null,
    daysSinceIntake:     null,
    daysSinceStageStart: null,
  },
  // Medical Evaluation — tracks stage time only, no "days since intake".
  18406060017: {
    daysSinceIntake: null,
  },
  // Subscription board — a separate schema almost end to end.
  18407459988: {
    dob:                 'text_mkvdefh1',
    phone:               'phone_mkp0q3cw',
    address:             'location_mkp0rs0v',
    primaryInsurance:    'color_mm254qxj',
    memberId1:           'text_mkvp6zfg',
    memberId2:           'text_mm25cpx6',
    doctorName:          'text_mkxn3wza',
    diagnosis:           'color_mkxrxv9w',
    referralSource:      'color_mm6thrwv',
    referralType:        null,
    serving:             null,
    daysSinceIntake:     null,
    daysSinceStageStart: null,
  },
};

/**
 * Resolve the effective { fieldName: columnId } map for a board.
 * @param {number} boardId
 * @returns {Record<string, string>}
 */
export function resolveColumns(boardId) {
  const overrides = BOARD_COLUMN_OVERRIDES[boardId] || {};
  const out = {};
  for (const [field, id] of Object.entries(SHARED_COLUMNS)) {
    const override = Object.prototype.hasOwnProperty.call(overrides, field) ? overrides[field] : id;
    if (override) out[field] = override;
  }
  return out;
}

/**
 * Medical Necessity board-specific columns.
 * `masterStage` / `advancer2a` / `advancer2b` used to point at column IDs that
 * no longer exist on this board; Monday drops unknown IDs silently, so they
 * read as permanently blank. Removed, and the MN evaluation fields Elena
 * actually needs to explain a decision are mapped instead.
 */
export const MN_COLUMNS = {
  stageAdvancer:      'color_mm1wyr92',
  subStage:           'color_mm1wyr92',
  advancer2c:         'color_mm1wf98t',
  advancer2d:         'color_mm1wcsbv',
  blocked:            'color_mm33ppgw',
  followUp:           'color_mm35v6a0',
  followUpDate:       'date_mm35kbkj',
  escalation:         'color_mm1x7997',
  medicalNecessity:   'color_mm1y6qrf',
  mnAttempts:         'color_mm1wz0vg',
  mrsClinicals:       'color_mm1y8rv8',
  // Coverage paths + evaluation detail — the "why" behind an MN determination
  cgmCoveragePath:    'color_mm1w7e5q',
  ipCoveragePath:     'color_mm1w5xn1',
  cgmLanguage:        'color_mm4bb5sm',
  lastVisit:          'date_mm1wb9br',
  mrExpiryDate:       'date_mm1ymthz',
  evaluationCounter:  'numeric_mm4bhjc8',
  cgmScriptReceived:  'color_mm44h0fx',
  ipScriptReceived:   'color_mm44chc8',
  oowDate:            'date_mm4kyfte',
  generalMnInvalidReasons: 'dropdown_mm2xppn8',
  cgmMnInvalidReasons:     'dropdown_mm2xncfh',
  ipMnInvalidReasons:      'dropdown_mm2xgg2y',
  ipMnNoReasons:           'dropdown_mm4bwxpv',
  mnRequestConsolidated:   'dropdown_mm2yd3a2',
  sendRequest:        'color_mm2y7t2x',
  requestSent:        'date_mm2yg8x8',
};

/** Insurance board-specific columns */
export const INS_COLUMNS = {
  stageAdvancer:      'color_mm1ws96t',
  activeNetwork:      'color_mm2vhwan',
  dmeBenefits:        'color_mm2vt8xg',
  sos:                'color_mm2vemyy',
  auth:               'color_mm2vg3ew',
  escalation:         'color_mm2vsh2f',
  notClearProducts:   'dropdown_mm2vez5a',
  skipSosProducts:    'dropdown_mm31163t',
  followUp:           'color_mm34jz1x',
  followUpDate:       'date_mm34m2dz',
  // Auth results per product
  authMonitor:        'color_mm1wgjd1',
  authSensors:        'color_mm1x5c99',
  authInsulinPump:    'color_mm1xnzmn',
  authInfusionSet:    'color_mm1xr2j1',
  authCartridge:      'color_mm1xybvt',
  // Auth IDs per product
  authIdMonitor:      'text_mm1w1d5p',
  authIdSensors:      'text_mm1x8tdp',
  authIdInsulinPump:  'text_mm1xmj8x',
  authIdInfusionSet:  'text_mm1xf6ht',
  authIdCartridge:    'text_mm1xs6s8',
};

/** Welcome Call board-specific columns */
export const WC_COLUMNS = {
  monitorQty:         'numeric_mm1xyfhc',
  pumpQty:            'numeric_mm1xa0z2',
  qtyInf1:            'numeric_mm1xv7wr',
  infusionSet1:       'color_mm1x9paw',
  subscriptionType:   'color_mm1xbqth',
  orderHandling:      'color_mm2776fg',
  advanceDecision:    'color_mm301cpp',
  callAttempts:       'text_mm322fg9',
};

/** Subscription board-specific columns */
export const SUB_COLUMNS = {
  status:             'color_mm2t7tdy',
  daysToOrder:        'color_mkxmtv9c',
  nextOrder:          'date_mkp0nvf1',
  subscription:       'color_mm273mv8',
  orderType:          'color_mm2w6kd',
};

// ─── GraphQL Helper ─────────────────────────────────────────────────────────────

/**
 * Execute a Monday.com GraphQL query (read-only).
 * @param {string} query - GraphQL query string
 * @param {Record<string, unknown>} [variables] - Query variables
 * @returns {Promise<any>} - The `data` property of the response
 */
async function mondayQuery(query, variables) {
  const token = getApiToken();

  const response = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': token,
      'Content-Type': 'application/json',
      'API-Version': MONDAY_API_VERSION,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Monday API HTTP ${response.status}: ${response.statusText} — ${body}`);
  }

  const result = await response.json();

  if (result.errors?.length) {
    const messages = result.errors.map(e => e.message).join('; ');
    throw new Error(`Monday GraphQL error: ${messages}`);
  }

  return result.data;
}

// ─── Column Value Parsing ───────────────────────────────────────────────────────

/**
 * Extract a usable column map from Monday's column_values array.
 * @param {Array<{id: string, text: string|null, value: string|null}>} columnValues
 * @returns {Record<string, {text: string, value: any}>}
 */
function parseColumnValues(columnValues) {
  const map = {};
  for (const cv of columnValues) {
    let parsed = null;
    if (cv.value) {
      try { parsed = JSON.parse(cv.value); } catch { parsed = cv.value; }
    }
    map[cv.id] = {
      text: cv.text || '',
      value: parsed,
    };
  }
  return map;
}

/**
 * Read the fields in `fieldNames` off a parsed column map, using the board's
 * resolved column IDs. Fields the board doesn't have come back as ''.
 * @param {Record<string, {text: string, value: any}>} cols
 * @param {number} boardId
 * @param {string[]} fieldNames
 * @returns {Record<string, string>}
 */
function readFields(cols, boardId, fieldNames) {
  const ids = resolveColumns(boardId);
  const out = {};
  for (const field of fieldNames) {
    out[field] = ids[field] ? (cols[ids[field]]?.text || '') : '';
  }
  return out;
}

/** Build the `column_values(ids: [...])` fragment for a board + field list. */
function columnIdsFragment(boardId, fieldNames) {
  const ids = resolveColumns(boardId);
  const wanted = fieldNames.map(f => ids[f]).filter(Boolean);
  return `column_values(ids: [${wanted.map(id => `"${id}"`).join(', ')}]) { id text value }`;
}

// ─── Exported Functions ─────────────────────────────────────────────────────────

/**
 * Search for a patient by name across all Command Center boards.
 * Returns matching items with board context (which board, which group, key fields).
 *
 * @param {string} name - Patient name or partial name to search for
 * @returns {Promise<Array<{itemId: string, name: string, boardId: number, boardName: string, groupId: string, groupAlias: string, serving: string, primaryInsurance: string, daysSinceIntake: string}>>}
 */
export async function searchPatient(name) {
  if (!name || typeof name !== 'string') {
    throw new Error('searchPatient requires a non-empty name string');
  }

  const boardIds = Object.values(BOARD_IDS);
  const results = [];
  const SUMMARY_FIELDS = ['serving', 'primaryInsurance', 'daysSinceIntake', 'dob', 'referralSource'];

  // Search each board in parallel
  const queries = boardIds.map(boardId => {
    const query = `
      {
        boards(ids: ${boardId}) {
          items_page(limit: 25, query_params: {
            rules: [{ column_id: "name", compare_value: "${name.replace(/"/g, '\\"')}" }],
            operator: or
          }) {
            items {
              id
              name
              group { id title }
              ${columnIdsFragment(boardId, SUMMARY_FIELDS)}
            }
          }
        }
      }
    `;
    return mondayQuery(query).then(data => ({ boardId, data }));
  });

  const responses = await Promise.allSettled(queries);

  for (const res of responses) {
    if (res.status !== 'fulfilled') {
      console.error('[elena-monday-reader] Board query failed:', res.reason?.message);
      continue;
    }
    const { boardId, data } = res.value;
    const items = data.boards?.[0]?.items_page?.items || [];

    for (const item of items) {
      const cols = parseColumnValues(item.column_values);
      const groupInfo = groupAliasFor(boardId, item.group.id, item.group.title);

      results.push({
        itemId: item.id,
        name: item.name,
        boardId,
        boardName: BOARD_NAMES[String(boardId)] || `Board ${boardId}`,
        groupId: item.group.id,
        groupAlias: groupInfo.groupAlias,
        groupTitle: item.group.title,
        ...readFields(cols, boardId, SUMMARY_FIELDS),
      });
    }
  }

  return results;
}

/**
 * Get full details for a specific patient by Monday item ID and board ID.
 * Returns all column values in a human-readable format.
 *
 * @param {string} itemId - Monday.com item ID
 * @param {number} boardId - Board ID the item belongs to
 * @returns {Promise<{itemId: string, name: string, boardId: number, boardName: string, groupId: string, groupAlias: string, groupTitle: string, columns: Record<string, string>}>}
 */
export async function getPatient(itemId, boardId) {
  if (!itemId || !boardId) {
    throw new Error('getPatient requires both itemId and boardId');
  }

  const query = `
    {
      items(ids: [${itemId}]) {
        id
        name
        board { id }
        group { id title }
        column_values {
          id
          column { title }
          text
          value
        }
      }
    }
  `;

  const data = await mondayQuery(query);
  const items = data.items || [];

  if (items.length === 0) {
    throw new Error(`Patient with item ID ${itemId} not found on board ${boardId}`);
  }

  const item = items[0];
  const groupInfo = groupAliasFor(boardId, item.group.id, item.group.title);

  // Build a human-readable column map using Monday's own column titles.
  // Skip separator/header columns (titles ending in --> or →) and empty values.
  const columns = {};
  for (const cv of item.column_values) {
    const title = cv.column?.title || cv.id;
    if (!cv.text && !cv.value) continue;                   // skip empty
    if (/-->$|→$/.test(title.trim())) continue;            // skip section headers
    if (title.trim() === '<-->') continue;                  // skip spacers
    columns[title] = cv.text || '';
  }

  return {
    itemId: item.id,
    name: item.name,
    boardId,
    boardName: BOARD_NAMES[String(boardId)] || `Board ${boardId}`,
    groupId: item.group.id,
    groupAlias: groupInfo.groupAlias,
    groupTitle: item.group.title,
    columns,
  };
}

/** Fields returned for each patient in a stage listing. */
const STAGE_FIELDS = [
  'serving', 'primaryInsurance', 'daysSinceIntake', 'daysSinceStageStart',
  'dob', 'doctorName', 'referralSource', 'referralType',
];

/** Monday's hard per-page cap on items_page. */
const PAGE_SIZE = 500;

/**
 * Page through every item in a board group, applying `onItem` to each.
 * Returns the true total, and whether the safety cap cut the walk short.
 *
 * Monday returns at most PAGE_SIZE items per request and hands back a cursor;
 * a single un-paged request silently truncates, which is how a 190-patient
 * stage used to get reported as "50".
 *
 * @param {number} boardId
 * @param {string} groupId
 * @param {(item: any) => void} onItem
 * @param {number} [maxItems=5000] - safety cap
 * @returns {Promise<{total: number, capped: boolean}>}
 */
async function walkGroup(boardId, groupId, onItem, maxItems = 5000) {
  const body = `cursor items { id name group { id title } ${columnIdsFragment(boardId, STAGE_FIELDS)} }`;
  let cursor = null;
  let total = 0;

  for (;;) {
    const query = cursor
      ? `{ next_items_page(limit: ${PAGE_SIZE}, cursor: "${cursor}") { ${body} } }`
      : `{ boards(ids: ${boardId}) {
             items_page(limit: ${PAGE_SIZE}, query_params: {
               rules: [{ column_id: "group", compare_value: ["${groupId}"] }]
             }) { ${body} }
           } }`;

    const data = await mondayQuery(query);
    const pageData = cursor ? data.next_items_page : data.boards?.[0]?.items_page;
    const items = pageData?.items || [];

    for (const item of items) {
      onItem(item);
      total++;
    }

    cursor = pageData?.cursor || null;
    if (!cursor || items.length === 0) return { total, capped: false };
    if (total >= maxItems) return { total, capped: true };
  }
}

/**
 * Get every patient in a board group/stage.
 *
 * Returns the FULL group (paged), plus the true count. `patients` may be capped
 * at `limit` rows to keep the payload sane, but `total` is always the real
 * number and `truncated` says whether rows were withheld — so a caller can
 * never mistake a page size for a stage size.
 *
 * @param {number} boardId - Board ID
 * @param {string} groupId - Monday group ID (e.g., "group_mm1xr3q3")
 * @param {number} [limit=50] - Max patient rows to return (counting is unaffected)
 * @returns {Promise<{patients: Array<object>, total: number, returned: number, truncated: boolean, capped: boolean}>}
 */
export async function getBoardGroupPatients(boardId, groupId, limit = 50) {
  if (!boardId || !groupId) {
    throw new Error('getBoardGroupPatients requires both boardId and groupId');
  }

  const patients = [];
  const { total, capped } = await walkGroup(boardId, groupId, item => {
    if (patients.length >= limit) return;
    const cols = parseColumnValues(item.column_values);
    patients.push({
      itemId: item.id,
      name: item.name,
      groupTitle: item.group.title,
      ...readFields(cols, boardId, STAGE_FIELDS),
    });
  });

  return {
    patients,
    total,
    returned: patients.length,
    truncated: patients.length < total,
    capped,
  };
}

/**
 * Count patients across board groups, optionally broken down by a field.
 *
 * This is the tool for "how many X are in the pipeline" — it walks every page,
 * so the number is the real number, not a page size.
 *
 * @param {Array<{stage: string, boardId: number, groupAlias: string}>} [stages]
 *        Defaults to the active pipeline.
 * @param {object} [opts]
 * @param {string} [opts.groupBy] - Field to break down by (e.g. "referralSource").
 * @param {{field: string, value: string}} [opts.where] - Case-insensitive equality filter.
 * @returns {Promise<{stages: Array<object>, total: number, filtered: number|null, breakdown: Record<string, number>|null, incomplete: boolean}>}
 */
export async function countPatients(stages = ACTIVE_PIPELINE, opts = {}) {
  const { groupBy = null, where = null } = opts;
  const results = [];
  const breakdown = groupBy ? {} : null;
  let total = 0;
  let filtered = where ? 0 : null;
  let incomplete = false;

  for (const stage of stages) {
    const groupId = BOARD_GROUPS[stage.boardId]?.[stage.groupAlias];
    if (!groupId) {
      results.push({ ...stage, error: `Unknown group "${stage.groupAlias}" on board ${stage.boardId}` });
      incomplete = true;
      continue;
    }

    let stageMatches = 0;
    const stageBreakdown = groupBy ? {} : null;

    const { total: stageTotal, capped } = await walkGroup(stage.boardId, groupId, item => {
      const cols = parseColumnValues(item.column_values);
      const fields = readFields(cols, stage.boardId, STAGE_FIELDS);

      if (where) {
        const actual = (fields[where.field] || '').trim().toLowerCase();
        if (actual !== String(where.value).trim().toLowerCase()) return;
        stageMatches++;
      }
      if (groupBy) {
        const key = (fields[groupBy] || '').trim() || '(blank)';
        stageBreakdown[key] = (stageBreakdown[key] || 0) + 1;
        breakdown[key] = (breakdown[key] || 0) + 1;
      }
    });

    if (capped) incomplete = true;
    total += stageTotal;
    if (where) filtered += stageMatches;

    results.push({
      stage: stage.stage,
      board: BOARD_NAMES[String(stage.boardId)] || `Board ${stage.boardId}`,
      total: stageTotal,
      ...(where ? { matching: stageMatches } : {}),
      ...(groupBy ? { breakdown: stageBreakdown } : {}),
      ...(capped ? { warning: 'Hit the safety cap — this stage count is a floor, not the total.' } : {}),
    });
  }

  return { stages: results, total, filtered, breakdown, incomplete };
}

/**
 * Get the UI state for a patient — determines which Command Center page they appear on,
 * what buttons are visible, what validation blocks exist, and any alerts.
 *
 * This is the core function for Elena to understand "what would a user see for this patient?"
 *
 * @param {string} itemId - Monday.com item ID
 * @param {number} boardId - Board ID
 * @returns {Promise<{
 *   patient: {name: string, itemId: string},
 *   page: string,
 *   role: string,
 *   stage: string,
 *   buttons: Array<{name: string, visible: boolean, reason: string}>,
 *   validationBlocks: string[],
 *   alerts: string[],
 *   summary: string
 * }>}
 */
export async function getUiState(itemId, boardId) {
  const patient = await getPatient(itemId, boardId);
  const cols = patient.columns;

  const result = {
    patient: { name: patient.name, itemId: patient.itemId },
    page: '',
    role: '',
    stage: patient.groupTitle,
    groupAlias: patient.groupAlias,
    buttons: [],
    validationBlocks: [],
    alerts: [],
    summary: '',
  };

  // ── Determine page/role based on board ──
  switch (boardId) {
    case BOARD_IDS.medical_necessity:
      result.page = 'Medical Necessity';
      result.role = 'Masheke';
      _analyzeMedicalNecessity(cols, patient.groupAlias, result);
      break;

    case BOARD_IDS.insurance:
      result.page = 'Insurance & Benefits';
      result.role = 'Samantha';
      _analyzeInsurance(cols, patient.groupAlias, result);
      break;

    case BOARD_IDS.welcome_call:
      result.page = 'Welcome Call + Final Confirm';
      result.role = 'Welcome Call Team';
      _analyzeWelcomeCall(cols, patient.groupAlias, result);
      break;

    case BOARD_IDS.profile:
      result.page = 'Profile Checklist';
      result.role = 'Profile Team';
      _analyzeProfile(cols, patient.groupAlias, result);
      break;

    case BOARD_IDS.subscription:
      result.page = 'Subscription';
      result.role = 'Subscription Team';
      _analyzeSubscription(cols, patient.groupAlias, result);
      break;
  }

  // Build summary
  const blockCount = result.validationBlocks.length;
  const alertCount = result.alerts.length;
  result.summary = `${patient.name} is on the "${result.page}" page (${result.stage} stage). ` +
    `${blockCount > 0 ? `${blockCount} validation block(s) prevent advancing. ` : 'No validation blocks. '}` +
    `${alertCount > 0 ? `${alertCount} alert(s) require attention.` : 'No alerts.'}`;

  return result;
}

// ─── UI State Analyzers (internal) ──────────────────────────────────────────────

/**
 * @param {Record<string, string>} cols
 * @param {string} groupAlias
 * @param {object} result - mutated in place
 */
function _analyzeMedicalNecessity(cols, groupAlias, result) {
  const blocked = cols.blocked || '';
  const followUp = cols.followUp || '';
  const followUpDate = cols.followUpDate || '';
  const escalation = cols.escalation || '';
  const subStage = cols.subStage || '';
  const masterStage = cols.masterStage || cols.stageAdvancer || '';
  const medNec = cols.medicalNecessity || '';
  const mnAttempts = cols.mnAttempts || '';
  const advancer2a = cols.advancer2a || '';
  const advancer2b = cols.advancer2b || '';
  const advancer2c = cols.advancer2c || '';
  const advancer2d = cols.advancer2d || '';

  // Alerts
  if (blocked && blocked.toLowerCase() !== '' && blocked.toLowerCase() !== 'no') {
    result.alerts.push(`Patient is BLOCKED: ${blocked}`);
  }
  if (followUp && followUp.toLowerCase() !== '' && followUp.toLowerCase() !== 'no') {
    result.alerts.push(`Follow-up required: ${followUp}${followUpDate ? ` (date: ${followUpDate})` : ''}`);
  }
  if (escalation && escalation.toLowerCase() !== '' && escalation.toLowerCase() !== 'no') {
    result.alerts.push(`Escalation active: ${escalation}`);
  }

  // Buttons
  result.buttons.push({
    name: 'Escalate',
    visible: true,
    reason: 'Always available on Medical Necessity page',
  });

  // Send to Monday validation
  const sendToMondayBlocks = [];
  if (!medNec) {
    sendToMondayBlocks.push('Medical Necessity field is not set');
  }
  if (!masterStage) {
    sendToMondayBlocks.push('Master Stage / Stage Advancer is not set');
  }

  result.buttons.push({
    name: 'Send to Monday',
    visible: sendToMondayBlocks.length === 0,
    reason: sendToMondayBlocks.length > 0
      ? `Blocked: ${sendToMondayBlocks.join('; ')}`
      : 'All required fields are set',
  });

  result.validationBlocks = sendToMondayBlocks;

  // Stage-specific context
  if (subStage) {
    result.alerts.push(`Current sub-stage: ${subStage}`);
  }
  if (mnAttempts) {
    result.alerts.push(`MN attempts: ${mnAttempts}`);
  }
}

/**
 * @param {Record<string, string>} cols
 * @param {string} groupAlias
 * @param {object} result
 */
function _analyzeInsurance(cols, groupAlias, result) {
  const activeNetwork = cols.activeNetwork || '';
  const dmeBenefits = cols.dmeBenefits || '';
  const sos = cols.sos || '';
  const auth = cols.auth || '';
  const escalation = cols.escalation || '';
  const followUp = cols.followUp || '';
  const followUpDate = cols.followUpDate || '';
  const stageAdvancer = cols.stageAdvancer || '';

  // Alerts
  if (escalation && escalation.toLowerCase() !== '' && escalation.toLowerCase() !== 'no') {
    result.alerts.push(`Escalation active: ${escalation}`);
  }
  if (followUp && followUp.toLowerCase() !== '' && followUp.toLowerCase() !== 'no') {
    result.alerts.push(`Follow-up required: ${followUp}${followUpDate ? ` (date: ${followUpDate})` : ''}`);
  }

  // Determine stage-specific button visibility
  const isBenefits = groupAlias === 'benefits';
  const isSubmitAuth = groupAlias === 'submitAuth';
  const isAuthOutstanding = groupAlias === 'authOutstanding';

  // Send to Monday validation for Benefits stage
  const sendToMondayBlocks = [];
  if (isBenefits) {
    if (!activeNetwork) sendToMondayBlocks.push('Active/Network check not completed');
    if (!dmeBenefits) sendToMondayBlocks.push('DME Benefits check not completed');
    if (!sos) sendToMondayBlocks.push('Same or Similar check not completed');
    if (!auth) sendToMondayBlocks.push('Auth determination not completed');

    // If auth is required, check product-level auth results
    if (auth === 'Auths Required') {
      const serving = cols.serving || '';
      const products = _getActiveProducts(serving);
      if (products.cgm && !cols.authMonitor) sendToMondayBlocks.push('CGM/Monitor auth result not set');
      if (products.sensors && !cols.authSensors) sendToMondayBlocks.push('Sensors auth result not set');
      if (products.ip && !cols.authInsulinPump) sendToMondayBlocks.push('Insulin Pump auth result not set');
      if (products.infusionSet && !cols.authInfusionSet) sendToMondayBlocks.push('Infusion Set auth result not set');
      if (products.cartridge && !cols.authCartridge) sendToMondayBlocks.push('Cartridge auth result not set');
    }
  }

  result.buttons.push({
    name: 'Send to Monday',
    visible: sendToMondayBlocks.length === 0,
    reason: sendToMondayBlocks.length > 0
      ? `Blocked: ${sendToMondayBlocks.join('; ')}`
      : 'All required checks completed',
  });

  result.buttons.push({
    name: 'Escalate',
    visible: true,
    reason: 'Always available on Insurance page',
  });

  if (isSubmitAuth || isAuthOutstanding) {
    result.buttons.push({
      name: 'Split Order',
      visible: true,
      reason: 'Available when patient is in Submit Auth or Auth Outstanding stage',
    });
  }

  result.validationBlocks = sendToMondayBlocks;

  // Status summary
  const checkStatus = [];
  if (activeNetwork) checkStatus.push(`Network: ${activeNetwork}`);
  if (dmeBenefits) checkStatus.push(`DME: ${dmeBenefits}`);
  if (sos) checkStatus.push(`SoS: ${sos}`);
  if (auth) checkStatus.push(`Auth: ${auth}`);
  if (checkStatus.length > 0) {
    result.alerts.push(`Check statuses: ${checkStatus.join(' | ')}`);
  }
}

/**
 * @param {Record<string, string>} cols
 * @param {string} groupAlias
 * @param {object} result
 */
function _analyzeWelcomeCall(cols, groupAlias, result) {
  const subscriptionType = cols.subscriptionType || '';
  const orderHandling = cols.orderHandling || '';
  const advanceDecision = cols.advanceDecision || '';
  const callAttempts = cols.callAttempts || '';

  const isWelcomeCall = groupAlias === 'welcomeCall';
  const isFinalConfirm = groupAlias === 'finalProfileConfirmation';

  // Alerts
  if (callAttempts) {
    result.alerts.push(`Call attempts: ${callAttempts}`);
  }
  if (groupAlias === 'stuck') {
    result.alerts.push('Patient is in STUCK status — requires manual review');
  }

  // Validation for Send to Monday
  const sendToMondayBlocks = [];
  if (isWelcomeCall) {
    if (!subscriptionType) sendToMondayBlocks.push('Subscription type not selected');
    if (!orderHandling) sendToMondayBlocks.push('Order handling not set');
  }
  if (isFinalConfirm) {
    if (!advanceDecision) sendToMondayBlocks.push('Advance decision not set');
  }

  result.buttons.push({
    name: 'Send to Monday',
    visible: sendToMondayBlocks.length === 0,
    reason: sendToMondayBlocks.length > 0
      ? `Blocked: ${sendToMondayBlocks.join('; ')}`
      : 'Ready to advance',
  });

  result.buttons.push({
    name: 'Mark Stuck',
    visible: isWelcomeCall || isFinalConfirm,
    reason: 'Available during active Welcome Call or Final Confirm stages',
  });

  result.validationBlocks = sendToMondayBlocks;
}

/**
 * @param {Record<string, string>} cols
 * @param {string} groupAlias
 * @param {object} result
 */
function _analyzeProfile(cols, groupAlias, result) {
  if (groupAlias === 'stuck') {
    result.alerts.push('Patient is in STUCK status — requires manual review');
  }
  if (groupAlias === 'completed') {
    result.alerts.push('Profile is completed — no further action needed');
  }

  result.buttons.push({
    name: 'Send to Monday',
    visible: groupAlias !== 'completed' && groupAlias !== 'stuck',
    reason: groupAlias === 'completed' || groupAlias === 'stuck'
      ? 'Not available in completed or stuck state'
      : 'Available for active profile stages',
  });

  result.buttons.push({
    name: 'Mark Stuck',
    visible: groupAlias !== 'completed' && groupAlias !== 'stuck',
    reason: 'Available for active profile stages',
  });
}

/**
 * @param {Record<string, string>} cols
 * @param {string} groupAlias
 * @param {object} result
 */
function _analyzeSubscription(cols, groupAlias, result) {
  const status = cols.status || '';
  const daysToOrder = cols.daysToOrder || '';
  const nextOrder = cols.nextOrder || '';
  const subscription = cols.subscription || '';
  const orderType = cols.orderType || '';

  if (groupAlias === 'notActive') {
    result.alerts.push('Subscription is NOT ACTIVE');
  }

  if (daysToOrder) {
    result.alerts.push(`Days to next order: ${daysToOrder}`);
  }
  if (nextOrder) {
    result.alerts.push(`Next order date: ${nextOrder}`);
  }
  if (status) {
    result.alerts.push(`Subscription status: ${status}`);
  }

  result.buttons.push({
    name: 'Send to Monday',
    visible: groupAlias === 'subscriptions',
    reason: groupAlias === 'subscriptions'
      ? 'Available for active subscriptions'
      : 'Not available for inactive subscriptions',
  });
}

// ─── Utility ────────────────────────────────────────────────────────────────────

/**
 * Given the "Serving" label text, returns which product categories are active.
 * @param {string} serving
 * @returns {{cgm: boolean, sensors: boolean, ip: boolean, infusionSet: boolean, cartridge: boolean}}
 */
function _getActiveProducts(serving) {
  const s = (serving || '').toLowerCase();
  const hasCgm = s.includes('cgm');
  const hasPump = s.includes('pump');
  return {
    cgm: hasCgm,
    sensors: hasCgm,
    ip: hasPump,
    infusionSet: hasPump,
    cartridge: hasPump,
  };
}

// ─── Field Explanation Lookup ───────────────────────────────────────────────────

/**
 * Static lookup table explaining what each field means in the Command Center context.
 * Returns a description, possible values, and how the field affects the UI.
 *
 * @param {number} boardId - Board ID for context (use 0 or null for board-agnostic)
 * @param {string} fieldName - Field name (e.g., "advancer2a", "blocked", "sos")
 * @returns {{field: string, description: string, possibleValues: string[]|null, uiEffect: string, board: string}}
 */
export function explainField(boardId, fieldName) {
  const key = fieldName.toLowerCase().replace(/[\s_-]/g, '');
  const entry = FIELD_EXPLANATIONS[key];

  if (!entry) {
    return {
      field: fieldName,
      description: `No documentation available for field "${fieldName}". It may be a custom or less common field.`,
      possibleValues: null,
      uiEffect: 'Unknown',
      board: boardId ? (BOARD_NAMES[String(boardId)] || `Board ${boardId}`) : 'All boards',
    };
  }

  return {
    field: fieldName,
    description: entry.description,
    possibleValues: entry.possibleValues || null,
    uiEffect: entry.uiEffect,
    board: entry.board || (boardId ? (BOARD_NAMES[String(boardId)] || `Board ${boardId}`) : 'All boards'),
  };
}

/** @type {Record<string, {description: string, possibleValues?: string[], uiEffect: string, board?: string}>} */
const FIELD_EXPLANATIONS = {
  // ── Shared Fields ──
  serving: {
    description: 'Which product combination the patient is being set up for. Determines which product-level columns are relevant.',
    possibleValues: ['Insulin Pump', 'Supplies Only', 'CGM', 'Insulin Pump + CGM', 'Supplies + CGM'],
    uiEffect: 'Controls which product auth columns appear in the Insurance checklist. Products not being served get "Not Serving" status.',
    board: 'All boards',
  },
  primaryinsurance: {
    description: 'The patient\'s primary insurance carrier. Used for benefits verification and auth requirements.',
    uiEffect: 'Displayed as context info. Influences which auth steps are required.',
    board: 'All boards',
  },
  referralsource: {
    description: 'WHO sent us this patient — the specific partner, manufacturer, clinic or channel. This is the field to filter or count on when someone asks about a named referral partner (e.g. "how many SNJ patients"). SNJ is a referral source, not an insurance, a state, or a territory.',
    possibleValues: [
      'Patient', 'Tandem', 'Beta Bionics', 'CareCentrix', 'Doctor',
      'Wellstart', 'Solace Advocates', 'SNJ', 'District Endochrine',
    ],
    uiEffect: 'Set at intake in the REFERRAL DETAILS section. Present on Profile, Medical Evaluation, Insurance and Welcome Call; the Subscription board keeps its own Referral Source column.',
    board: 'All boards',
  },
  referraltype: {
    description: 'WHAT KIND of referral this is — the category of the source, not the source itself. Pair it with Referral Source: Referral Type says "Manufacturer", Referral Source says which one.',
    possibleValues: ['Manufacturer', 'Payor', 'Patient', 'Doctor', 'Advocacy Group'],
    uiEffect: 'Set at intake alongside Referral Source in the REFERRAL DETAILS section.',
    board: 'All boards',
  },
  dob: {
    description: 'Patient date of birth. Stored as text.',
    uiEffect: 'Displayed as patient context info.',
    board: 'All boards',
  },
  diagnosis: {
    description: 'Patient\'s diabetes diagnosis type. Determines clinical pathway.',
    uiEffect: 'Displayed as context. May affect which medical necessity steps are required.',
    board: 'All boards',
  },
  doctorname: {
    description: 'The prescribing doctor\'s name.',
    uiEffect: 'Displayed as context. Used for medical necessity outreach.',
    board: 'All boards',
  },
  dayssinceintake: {
    description: 'Number of days since the patient entered the pipeline. Auto-calculated status column.',
    uiEffect: 'Color-coded indicator: longer times may flag as yellow/red to indicate urgency.',
    board: 'All boards',
  },
  dayssincestagestart: {
    description: 'Number of days the patient has been in their current stage. Auto-calculated.',
    uiEffect: 'Color-coded urgency indicator. Helps identify patients stuck in a stage.',
    board: 'All boards',
  },
  memberid1: {
    description: 'Primary insurance member ID number.',
    uiEffect: 'Displayed as patient context info for insurance verification.',
    board: 'All boards',
  },
  memberid2: {
    description: 'Secondary insurance member ID number (if applicable).',
    uiEffect: 'Displayed as patient context info.',
    board: 'All boards',
  },

  // ── Medical Necessity Fields ──
  substage: {
    description: 'The current sub-stage within Medical Necessity. Tracks granular progress through the MN workflow.',
    uiEffect: 'Determines which step of the MN process the patient is on.',
    board: 'Medical Necessity (Masheke)',
  },
  masterstage: {
    description: 'The master stage / stage advancer. Controls the high-level progression through the pipeline.',
    uiEffect: 'Primary field used by Send to Monday to advance the patient. Must be set before sending.',
    board: 'Medical Necessity (Masheke)',
  },
  stageadvancer: {
    description: 'Same as Master Stage. Controls which pipeline stage the patient advances to when synced.',
    uiEffect: 'Must be set for Send to Monday to be enabled. Determines the destination group.',
    board: 'Medical Necessity / Insurance',
  },
  advancer2a: {
    description: 'Stage advancer sub-step 2A. Part of the multi-step MN clinical evaluation.',
    uiEffect: 'One of the clinical eval checkpoints. Feeds into overall MN determination.',
    board: 'Medical Necessity (Masheke)',
  },
  advancer2b: {
    description: 'Stage advancer sub-step 2B. Part of the multi-step MN clinical evaluation.',
    uiEffect: 'One of the clinical eval checkpoints.',
    board: 'Medical Necessity (Masheke)',
  },
  advancer2c: {
    description: 'Stage advancer sub-step 2C. Part of the multi-step MN clinical evaluation.',
    uiEffect: 'One of the clinical eval checkpoints.',
    board: 'Medical Necessity (Masheke)',
  },
  advancer2d: {
    description: 'Stage advancer sub-step 2D. Part of the multi-step MN clinical evaluation.',
    uiEffect: 'One of the clinical eval checkpoints.',
    board: 'Medical Necessity (Masheke)',
  },
  blocked: {
    description: 'Indicates the patient is blocked from progressing. Set when an external dependency or issue prevents advancement.',
    uiEffect: 'Shows a red alert banner. May disable Send to Monday. Requires manual resolution.',
    board: 'Medical Necessity (Masheke)',
  },
  followup: {
    description: 'Indicates a follow-up action is needed. Can be set on MN or Insurance boards.',
    uiEffect: 'Shows a follow-up alert. Often paired with followUpDate to schedule the action.',
    board: 'Medical Necessity / Insurance',
  },
  followupdate: {
    description: 'The date when follow-up action should be taken.',
    uiEffect: 'Displayed alongside the follow-up alert. May trigger reminders.',
    board: 'Medical Necessity / Insurance',
  },
  escalation: {
    description: 'Marks the patient as escalated. Used when normal workflow cannot resolve an issue.',
    uiEffect: 'Shows an escalation alert. Escalated patients may be highlighted in the UI.',
    board: 'Medical Necessity / Insurance',
  },
  medicalnecessity: {
    description: 'The medical necessity determination result. Core field for the MN board.',
    uiEffect: 'Must be set before Send to Monday is enabled. Determines if the patient can proceed to Insurance.',
    board: 'Medical Necessity (Masheke)',
  },
  mnattempts: {
    description: 'Number of medical necessity outreach attempts made (e.g., calls to the doctor\'s office).',
    uiEffect: 'Displayed as context. High attempt counts may trigger escalation.',
    board: 'Medical Necessity (Masheke)',
  },
  mrsclinicals: {
    description: 'Status of MRS (Medical Records Service) clinical documentation.',
    uiEffect: 'Part of the clinical evaluation workflow.',
    board: 'Medical Necessity (Masheke)',
  },

  // ── Insurance Fields ──
  activenetwork: {
    description: 'Whether the patient\'s insurance is active and in-network. First of the four universal insurance checks.',
    possibleValues: ['Active/In-network', 'Stuck'],
    uiEffect: 'Checkbox in the Insurance checklist. Must be completed before Send to Monday.',
    board: 'Insurance & Benefits (Samantha)',
  },
  dmebenefits: {
    description: 'Whether DME (Durable Medical Equipment) benefits are confirmed. Second universal insurance check.',
    possibleValues: ['Yes', 'Partial / No'],
    uiEffect: 'Checkbox in the Insurance checklist. Must be completed before Send to Monday.',
    board: 'Insurance & Benefits (Samantha)',
  },
  sos: {
    description: 'Same or Similar check — verifies no conflicting equipment claims. Third universal insurance check.',
    possibleValues: ['All Clear', 'Partial / Not Clear'],
    uiEffect: 'Checkbox in the Insurance checklist. Must be completed before Send to Monday. "Not Clear" may require product-level handling.',
    board: 'Insurance & Benefits (Samantha)',
  },
  auth: {
    description: 'Whether prior authorizations are required. Fourth universal insurance check.',
    possibleValues: ['Auths Required', 'No Auths Required'],
    uiEffect: 'If "Auths Required", the product-specific auth result columns become mandatory. If "No Auths Required", product auth columns are skipped.',
    board: 'Insurance & Benefits (Samantha)',
  },
  notclearproducts: {
    description: 'Dropdown listing which products are not clear on Same or Similar.',
    uiEffect: 'Displayed when SoS is "Partial / Not Clear". Indicates which products need attention.',
    board: 'Insurance & Benefits (Samantha)',
  },
  skipsosproducts: {
    description: 'Dropdown listing which products to skip SoS check for.',
    uiEffect: 'Allows bypassing SoS for specific products when not applicable.',
    board: 'Insurance & Benefits (Samantha)',
  },

  // Auth result columns (shared structure)
  authmonitor: {
    description: 'Authorization result for CGM monitor.',
    possibleValues: ['Evaluate', 'Auth Valid', 'Denied', 'No Auth Needed', 'Submitted', 'Required', 'Not Serving'],
    uiEffect: 'Shown in the product auth section when the patient is being served CGM. Must be resolved before Send to Monday if auth is required.',
    board: 'Insurance & Benefits (Samantha)',
  },
  authsensors: {
    description: 'Authorization result for CGM sensors.',
    possibleValues: ['Evaluate', 'Auth Valid', 'Denied', 'No Auth Needed', 'Submitted', 'Required', 'Not Serving'],
    uiEffect: 'Shown in the product auth section when the patient is being served CGM.',
    board: 'Insurance & Benefits (Samantha)',
  },
  authinsulinpump: {
    description: 'Authorization result for insulin pump.',
    possibleValues: ['Evaluate', 'Auth Valid', 'Denied', 'No Auth Needed', 'Submitted', 'Required', 'Not Serving'],
    uiEffect: 'Shown in the product auth section when the patient is being served insulin pump.',
    board: 'Insurance & Benefits (Samantha)',
  },
  authinfusionset: {
    description: 'Authorization result for infusion sets.',
    possibleValues: ['Evaluate', 'Auth Valid', 'Denied', 'No Auth Needed', 'Submitted', 'Required', 'Not Serving'],
    uiEffect: 'Shown in the product auth section when the patient is being served insulin pump.',
    board: 'Insurance & Benefits (Samantha)',
  },
  authcartridge: {
    description: 'Authorization result for cartridges.',
    possibleValues: ['Evaluate', 'Auth Valid', 'Denied', 'No Auth Needed', 'Submitted', 'Required', 'Not Serving'],
    uiEffect: 'Shown in the product auth section when the patient is being served insulin pump.',
    board: 'Insurance & Benefits (Samantha)',
  },

  // ── Welcome Call Fields ──
  monitorqty: {
    description: 'Quantity of CGM monitors to order.',
    uiEffect: 'Numeric input in the Welcome Call order form.',
    board: 'Welcome Call + Final Confirm',
  },
  pumpqty: {
    description: 'Quantity of insulin pumps to order.',
    uiEffect: 'Numeric input in the Welcome Call order form.',
    board: 'Welcome Call + Final Confirm',
  },
  qtyinf1: {
    description: 'Quantity of infusion sets to order.',
    uiEffect: 'Numeric input in the Welcome Call order form.',
    board: 'Welcome Call + Final Confirm',
  },
  infusionset1: {
    description: 'Specific infusion set type selected.',
    uiEffect: 'Status/dropdown in the Welcome Call form. Determines which infusion set SKU to order.',
    board: 'Welcome Call + Final Confirm',
  },
  subscriptiontype: {
    description: 'The subscription plan type selected during the welcome call.',
    uiEffect: 'Must be set before Send to Monday is enabled in the Welcome Call stage.',
    board: 'Welcome Call + Final Confirm',
  },
  orderhandling: {
    description: 'How the order should be handled (e.g., standard, rush, special instructions).',
    uiEffect: 'Must be set before Send to Monday is enabled in the Welcome Call stage.',
    board: 'Welcome Call + Final Confirm',
  },
  advancedecision: {
    description: 'The decision to advance the patient from Final Profile Confirmation.',
    uiEffect: 'Must be set before Send to Monday is enabled in the Final Confirm stage.',
    board: 'Welcome Call + Final Confirm',
  },
  callattempts: {
    description: 'Text field tracking the number of welcome call attempts.',
    uiEffect: 'Displayed as context. High attempt counts may indicate a hard-to-reach patient.',
    board: 'Welcome Call + Final Confirm',
  },

  // ── Subscription Fields ──
  status: {
    description: 'Current subscription status.',
    uiEffect: 'Primary indicator on the Subscription page. Active vs. inactive determines available actions.',
    board: 'Subscription',
  },
  daystoorder: {
    description: 'Number of days until the next order should be placed.',
    uiEffect: 'Color-coded urgency indicator. Low numbers trigger reorder alerts.',
    board: 'Subscription',
  },
  nextorder: {
    description: 'Date of the next scheduled order.',
    uiEffect: 'Displayed on the Subscription page. Used for reorder planning.',
    board: 'Subscription',
  },
  subscription: {
    description: 'The subscription plan details.',
    uiEffect: 'Displayed on the Subscription page.',
    board: 'Subscription',
  },
  ordertype: {
    description: 'Type of order (e.g., initial, reorder, replacement).',
    uiEffect: 'Displayed on the Subscription page. May affect order handling.',
    board: 'Subscription',
  },
};
