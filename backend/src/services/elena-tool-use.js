/**
 * elena-tool-use.js
 *
 * Wires the Monday.com reader into Elena's chat flow using Claude's tool_use feature.
 * Replaces Elena's simple anthropic.messages.create() call with a tool-use loop
 * that gives the LLM read-only access to Command Center data.
 *
 * Usage:
 *   import { chatWithTools } from './elena-tool-use.js';
 *
 *   // In elena.js, replace the simple anthropic.messages.create() call with:
 *   // const assistantMessage = await chatWithTools(conversationId, userMessage, systemPrompt, messages);
 *
 * Env:
 *   ANTHROPIC_API_KEY — Anthropic API key (used by the Anthropic SDK)
 *   MONDAY_API_TOKEN  — Monday.com API token (used by elena-monday-reader)
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  searchPatient,
  getPatient,
  getBoardGroupPatients,
  getUiState,
  explainField,
  countPatients,
  BOARD_IDS,
  BOARD_GROUPS,
  BOARD_NAMES,
  ACTIVE_PIPELINE,
} from './elena-monday-reader.js';

// ─── Rules Engine (shared pgvector) ────────────────────────────────────────────

let getAllActiveRules, deactivateRule;
try {
  const rules = await import('./rules.js');
  getAllActiveRules = rules.getAllActiveRules;
  deactivateRule = rules.deactivateRule;
} catch (err) {
  console.warn('[elena-tool-use] Rules module not available:', err.message);
  getAllActiveRules = async () => [];
  deactivateRule = async () => null;
}

// ─── Anthropic Client ───────────────────────────────────────────────────────────

const anthropic = new Anthropic();
const SONNET_MODEL = process.env.SONNET_MODEL || 'claude-sonnet-5';

// ─── Board / Group ID Mapping ───────────────────────────────────────────────────

/** Map tool enum values to Monday board IDs */
const BOARD_ENUM_TO_ID = {
  medical_necessity: BOARD_IDS.medical_necessity,
  insurance:         BOARD_IDS.insurance,
  welcome_call:      BOARD_IDS.welcome_call,
  profile:           BOARD_IDS.profile,
  subscription:      BOARD_IDS.subscription,
};

/**
 * Map group alias → every { boardId, groupId } that uses it.
 *
 * Aliases are NOT unique across boards ("stuck", "completed" and "escalations"
 * each exist on several). Keeping every candidate lets an ambiguous lookup fail
 * loudly and ask for the board, instead of silently answering about the wrong
 * board — which is how "who's stuck?" used to return one arbitrary board.
 * @type {Record<string, Array<{boardId: number, groupId: string}>>}
 */
const GROUP_NAME_TO_IDS = {};
for (const [boardKey, groups] of Object.entries(BOARD_GROUPS)) {
  for (const [alias, groupId] of Object.entries(groups)) {
    const key = alias.toLowerCase();
    (GROUP_NAME_TO_IDS[key] ||= []).push({ boardId: Number(boardKey), groupId });
  }
}

/**
 * Resolve a board enum string to a numeric board ID.
 * @param {string} boardEnum
 * @returns {number}
 */
function resolveBoardId(boardEnum) {
  const id = BOARD_ENUM_TO_ID[boardEnum];
  if (!id) {
    throw new Error(`Unknown board: "${boardEnum}". Valid values: ${Object.keys(BOARD_ENUM_TO_ID).join(', ')}`);
  }
  return id;
}

/**
 * Resolve a group name to { boardId, groupId }.
 * If a board enum is also provided, uses that board's groups specifically.
 * @param {string} groupName
 * @param {string} [boardEnum]
 * @returns {{boardId: number, groupId: string}}
 */
function resolveGroup(groupName, boardEnum) {
  const normalizedGroup = groupName.toLowerCase().replace(/[\s_-]/g, '');

  // If board is specified, look in that board's groups first
  if (boardEnum) {
    const boardId = resolveBoardId(boardEnum);
    const boardGroups = BOARD_GROUPS[boardId];
    if (boardGroups) {
      for (const [alias, groupId] of Object.entries(boardGroups)) {
        if (alias.toLowerCase() === normalizedGroup) {
          return { boardId, groupId };
        }
      }
    }
  }

  // Fall back to global lookup
  const matches = GROUP_NAME_TO_IDS[normalizedGroup];
  if (!matches || matches.length === 0) {
    const allGroups = Object.keys(GROUP_NAME_TO_IDS).join(', ');
    throw new Error(`Unknown group: "${groupName}". Available groups: ${allGroups}`);
  }
  if (matches.length > 1) {
    const boards = matches
      .map(m => `${BOARD_NAMES[String(m.boardId)] || m.boardId}`)
      .join(', ');
    throw new Error(
      `Ambiguous group "${groupName}" — it exists on more than one board (${boards}). ` +
      `Re-run with the "board" argument set so the answer is about the right board.`
    );
  }
  return matches[0];
}

// ─── Tool Definitions ───────────────────────────────────────────────────────────

/** @type {Anthropic.Tool[]} */
const TOOLS = [
  {
    name: 'search_patient',
    description:
      'Search for a patient by name across all Command Center boards. Use when the user mentions a patient by name and you need to look up their data.',
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Patient name or partial name to search for',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'get_patient_details',
    description:
      'Get full details for a specific patient including all their Monday.com column values. Use after search_patient to get complete data.',
    input_schema: {
      type: 'object',
      properties: {
        item_id: {
          type: 'string',
          description: 'Monday.com item ID',
        },
        board: {
          type: 'string',
          enum: ['medical_necessity', 'insurance', 'welcome_call', 'profile', 'subscription'],
          description: 'Which board this patient is on',
        },
      },
      required: ['item_id', 'board'],
    },
  },
  {
    name: 'get_ui_state',
    description:
      'Determine what a user would see in the Command Center for this patient — which page they appear on, which buttons are visible, what validation blocks sending, and any alerts. Use this when the user asks "why can\'t I see X" or "what should I do with this patient".',
    input_schema: {
      type: 'object',
      properties: {
        item_id: {
          type: 'string',
          description: 'Monday.com item ID',
        },
        board: {
          type: 'string',
          enum: ['medical_necessity', 'insurance', 'welcome_call', 'profile', 'subscription'],
          description: 'Which board',
        },
      },
      required: ['item_id', 'board'],
    },
  },
  {
    name: 'list_patients_in_stage',
    description:
      'List all patients currently in a specific board group/stage. Use when the user asks "who is in Benefits right now" or "show me the Welcome Call queue".',
    input_schema: {
      type: 'object',
      properties: {
        board: {
          type: 'string',
          enum: ['medical_necessity', 'insurance', 'welcome_call', 'profile', 'subscription'],
          description: 'Which board to look in',
        },
        group: {
          type: 'string',
          description:
            'Group name like "benefits", "submitAuth", "authOutstanding", "welcomeCall", "finalProfileConfirmation", "intake", "medicalNecessity", "subscriptions", "notActive", "completed", "stuck"',
        },
      },
      required: ['board', 'group'],
    },
  },
  {
    name: 'count_patients',
    description:
      'Count patients across pipeline stages — the ONLY correct way to answer "how many". It pages through every item, so the numbers are real totals, not page sizes. Use `where` to filter (e.g. every patient whose referralSource is "SNJ") and/or `group_by` to get a breakdown (e.g. how the pipeline splits across referral sources). Prefer this over list_patients_in_stage whenever the question is about a count, a share, or a comparison. If you do not know what value to filter on, call explain_field first to see the valid values for that field — never guess at what an abbreviation means.\n\nIMPORTANT — "Medical Necessity" is ambiguous and the two readings differ by a lot. The Medical Necessity STAGE is the whole board group (every patient anywhere in the MN workflow). The team usually means the Evaluate MN BUCKET — the ones actually awaiting a determination right now. Whenever a question is about Medical Necessity counts, group_by "mnSubStage" and report the Evaluate MN number and the stage total, saying which is which. Never give one number alone.',
    input_schema: {
      type: 'object',
      properties: {
        stages: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Which pipeline stages to count. Omit for the full active pipeline (Intake, Medical Necessity, Benefits, Submit Auth, Auth Outstanding, Welcome Call, Final Profile Confirmation). Completed/Stuck/Escalation groups are NOT active pipeline and are excluded unless named here.',
        },
        where_field: {
          type: 'string',
          enum: ['referralSource', 'referralType', 'primaryInsurance', 'serving', 'doctorName', 'mnSubStage'],
          description: 'Field to filter on. Pair with where_value. mnSubStage exists only on the Medical Evaluation board; its values are "Evaluate MN", "Send Request", "Confirm Receipt", "Chase Clinicals" and "Doctor Appointment".',
        },
        where_value: {
          type: 'string',
          description: 'Exact value to match, case-insensitive (e.g. "SNJ", "CareCentrix", "CGM").',
        },
        group_by: {
          type: 'string',
          enum: ['referralSource', 'referralType', 'primaryInsurance', 'serving', 'mnSubStage'],
          description: 'Return a per-value breakdown of the counted patients. Use "mnSubStage" for any Medical Necessity question to split the stage into Evaluate MN / Send Request / Confirm Receipt / Chase Clinicals.',
        },
      },
      required: [],
    },
  },
  {
    name: 'explain_field',
    description:
      'Explain what a field in the Command Center means, its possible values, and how it affects the UI. Use when the user asks "what does X mean" or "what are the options for Y".',
    input_schema: {
      type: 'object',
      properties: {
        field_name: {
          type: 'string',
          description:
            'Field name like "advancer2a", "subStage", "medicalNecessity", "sos", "blocked", "activeNetwork", "dmeBenefits", "auth", "subscriptionType", "orderHandling", etc.',
        },
        board: {
          type: 'string',
          enum: ['medical_necessity', 'insurance', 'welcome_call', 'profile', 'subscription'],
          description: 'Which board context (optional, improves specificity)',
        },
      },
      required: ['field_name'],
    },
  },
  {
    name: 'lookup_command_center_code',
    description:
      'Fetch current source code from the Command Center GitHub repo. The code changes frequently, so ALWAYS use this tool when someone asks how a specific feature works, what an endpoint does, how a component renders, or anything about the current implementation. Use list_files to browse the repo structure, or read_file to get specific file contents.',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list_files', 'read_file'],
          description: 'list_files to browse directory structure, read_file to get file contents',
        },
        path: {
          type: 'string',
          description: 'Path within the repo. For list_files: directory path (e.g., "backend/src/routes" or "" for root). For read_file: full file path (e.g., "backend/src/routes/assistant.js")',
        },
      },
      required: ['action', 'path'],
    },
  },
  {
    name: 'manage_rules',
    description:
      'View and manage Elena\'s learned rules (business rules that override all other context). Use list_rules to see all active rules. Use delete_rule to remove a specific rule by ID. IMPORTANT: when a user asks to forget or delete a rule, ALWAYS call list_rules first, show the matching rule(s) to the user, and ask for explicit confirmation BEFORE calling delete_rule.',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list_rules', 'delete_rule'],
          description: 'list_rules to see all active rules, delete_rule to deactivate a specific rule',
        },
        rule_id: {
          type: 'number',
          description: 'Rule ID to delete (required for delete_rule). Get this from list_rules first.',
        },
      },
      required: ['action'],
    },
  },
];

// ─── GitHub Code Lookup ────────────────────────────────────────────────────────

const CC_REPO = 'medically-modern/command-center';
const GH_TOKEN = process.env.GITHUB_PAT || '';

/**
 * Fetch current code from the Command Center GitHub repo.
 * Supports listing directory contents or reading a specific file.
 */
async function fetchCommandCenterCode(action, filePath) {
  if (!GH_TOKEN) {
    return JSON.stringify({ error: 'GITHUB_PAT not set — cannot access Command Center repo' });
  }

  const cleanPath = (filePath || '').replace(/^\/+/, '');
  const url = `https://api.github.com/repos/${CC_REPO}/contents/${cleanPath}`;

  try {
    const resp = await fetch(url, {
      headers: {
        'Authorization': `token ${GH_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      return JSON.stringify({ error: `GitHub API ${resp.status}: ${body.substring(0, 200)}` });
    }

    const data = await resp.json();

    if (action === 'list_files') {
      // Directory listing
      if (!Array.isArray(data)) {
        return JSON.stringify({ error: 'Path is a file, not a directory. Use read_file instead.', name: data.name });
      }
      const entries = data.map(item => ({
        name: item.name,
        type: item.type, // 'file' or 'dir'
        path: item.path,
        size: item.size || 0,
      }));
      return JSON.stringify({ path: cleanPath || '/', entries, count: entries.length });
    }

    if (action === 'read_file') {
      // File content
      if (Array.isArray(data)) {
        return JSON.stringify({ error: 'Path is a directory, not a file. Use list_files instead.' });
      }
      if (data.size > 100000) {
        return JSON.stringify({ error: `File too large (${data.size} bytes). Try a more specific path.` });
      }
      const content = Buffer.from(data.content, 'base64').toString('utf-8');
      return JSON.stringify({ path: data.path, size: data.size, content });
    }

    return JSON.stringify({ error: `Unknown action: ${action}` });
  } catch (err) {
    return JSON.stringify({ error: `GitHub fetch failed: ${err.message}` });
  }
}

// ─── Tool Execution ─────────────────────────────────────────────────────────────

/**
 * Execute a single tool call and return the result.
 * @param {string} toolName
 * @param {Record<string, any>} toolInput
 * @returns {Promise<string>} JSON-stringified result
 */
async function executeTool(toolName, toolInput) {
  try {
    switch (toolName) {
      case 'search_patient': {
        const results = await searchPatient(toolInput.name);
        if (results.length === 0) {
          return JSON.stringify({
            found: false,
            message: `No patients found matching "${toolInput.name}" across any Command Center board.`,
          });
        }
        return JSON.stringify({ found: true, count: results.length, patients: results });
      }

      case 'get_patient_details': {
        const boardId = resolveBoardId(toolInput.board);
        const patient = await getPatient(toolInput.item_id, boardId);
        return JSON.stringify(patient);
      }

      case 'get_ui_state': {
        const boardId = resolveBoardId(toolInput.board);
        const state = await getUiState(toolInput.item_id, boardId);
        return JSON.stringify(state);
      }

      case 'list_patients_in_stage': {
        const { boardId, groupId } = resolveGroup(toolInput.group, toolInput.board);
        const { patients, total, returned, truncated, capped } =
          await getBoardGroupPatients(boardId, groupId);
        return JSON.stringify({
          board: toolInput.board,
          group: toolInput.group,
          // total is the REAL size of the stage; returned is how many rows are below.
          total,
          returned,
          truncated,
          ...(truncated ? {
            note: `Showing ${returned} of ${total} patients. Report ${total} as the count for this stage — never ${returned}.`,
          } : {}),
          ...(capped ? { warning: 'Safety cap hit — total is a floor, not the exact count.' } : {}),
          patients,
        });
      }

      case 'count_patients': {
        const stages = Array.isArray(toolInput.stages) && toolInput.stages.length
          ? toolInput.stages.map(name => {
              const match = ACTIVE_PIPELINE.find(
                s => s.stage.toLowerCase() === String(name).toLowerCase() ||
                     s.groupAlias.toLowerCase() === String(name).toLowerCase().replace(/[\s_-]/g, '')
              );
              if (match) return match;
              const { boardId, groupId } = resolveGroup(String(name));
              const alias = Object.entries(BOARD_GROUPS[boardId] || {})
                .find(([, gid]) => gid === groupId)?.[0];
              return { stage: String(name), boardId, groupAlias: alias };
            })
          : ACTIVE_PIPELINE;

        const where = toolInput.where_field && toolInput.where_value
          ? { field: toolInput.where_field, value: toolInput.where_value }
          : null;

        const result = await countPatients(stages, { groupBy: toolInput.group_by || null, where });
        return JSON.stringify({
          scope: stages === ACTIVE_PIPELINE ? 'active pipeline' : stages.map(s => s.stage).join(', '),
          ...(where ? { filter: `${where.field} = "${where.value}"` } : {}),
          ...result,
          note: where
            ? `${result.filtered} of ${result.total} patients in scope match. These are complete counts — every page was walked.`
            : 'These are complete counts — every page was walked.',
        });
      }

      case 'explain_field': {
        const boardId = toolInput.board ? resolveBoardId(toolInput.board) : 0;
        const explanation = explainField(boardId, toolInput.field_name);
        return JSON.stringify(explanation);
      }

      case 'lookup_command_center_code': {
        return await fetchCommandCenterCode(toolInput.action, toolInput.path);
      }

      case 'manage_rules': {
        if (toolInput.action === 'list_rules') {
          const rules = await getAllActiveRules();
          if (rules.length === 0) {
            return JSON.stringify({ rules: [], message: 'No active rules.' });
          }
          return JSON.stringify({
            count: rules.length,
            rules: rules.map(r => ({
              id: r.id,
              rule: r.content,
              category: r.category,
              created: r.created_at,
            })),
          });
        }
        if (toolInput.action === 'delete_rule') {
          if (!toolInput.rule_id) {
            return JSON.stringify({ error: 'rule_id is required for delete_rule' });
          }
          const deactivated = await deactivateRule(toolInput.rule_id);
          if (!deactivated) {
            return JSON.stringify({ error: `Rule ${toolInput.rule_id} not found or already deleted.` });
          }
          return JSON.stringify({
            deleted: true,
            id: deactivated.id,
            rule: deactivated.content,
            message: 'Rule has been deactivated.',
          });
        }
        return JSON.stringify({ error: `Unknown action: ${toolInput.action}` });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (err) {
    console.error(`[elena-tool-use] Tool "${toolName}" failed:`, err.message);
    return JSON.stringify({
      error: err.message,
      tool: toolName,
      input: toolInput,
    });
  }
}

// ─── Status Descriptions ────────────────────────────────────────────────────────

/**
 * Generate a human-readable status message for a tool call.
 */
function describeToolUse(toolName, input) {
  switch (toolName) {
    case 'search_patient':
      return `Searching for patient "${input.name}"...`;
    case 'get_patient_details':
      return `Pulling patient details from ${input.board?.replace(/_/g, ' ')}...`;
    case 'get_ui_state':
      return `Checking Command Center status...`;
    case 'list_patients_in_stage':
      return `Loading ${input.group} queue...`;
    case 'count_patients':
      return input.where_value
        ? `Counting ${input.where_value} patients across the pipeline...`
        : `Counting the pipeline...`;
    case 'explain_field':
      return `Looking up field "${input.field_name}"...`;
    case 'lookup_command_center_code':
      return input.action === 'list_files'
        ? `Browsing code repository...`
        : `Reading source code...`;
    case 'manage_rules':
      return input.action === 'list_rules'
        ? `Checking active rules...`
        : `Updating rules...`;
    default:
      return `Working...`;
  }
}

// ─── Tool-Use Loop ──────────────────────────────────────────────────────────────


/**
 * Chat with Claude using tool-use for Monday.com data access.
 *
 * Replaces the simple `anthropic.messages.create()` call with a loop that
 * handles tool_use responses, executes the tools, feeds results back, and
 * loops until Claude produces a final text response.
 *
 * @param {string} conversationId - Conversation ID (for logging)
 * @param {string} userMessage - The user's latest message
 * @param {string} systemPrompt - System prompt for Claude
 * @param {Array<{role: string, content: string|Array}>} history - Previous message history
 * @param {((status: string) => void)|null} onStatus - Optional callback for streaming status updates
 * @returns {Promise<string>} The final assistant text response
 */
export async function chatWithTools(conversationId, userMessage, systemPrompt, history = [], onStatus = null) {
  // Build the messages array: history + new user message
  const messages = [
    ...history,
    { role: 'user', content: userMessage },
  ];

  let round = 0;

  while (true) {
    round++;

    console.log(`[elena-tool-use] [${conversationId}] Round ${round} — calling Claude with ${messages.length} messages`);

    const response = await anthropic.messages.create({
      model: SONNET_MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      tools: TOOLS,
      tool_choice: { type: 'auto' },
      messages,
    });

    // If Claude is done (no more tool calls), extract and return the text
    if (response.stop_reason === 'end_turn') {
      const textBlocks = response.content.filter(block => block.type === 'text');
      const finalText = textBlocks.map(block => block.text).join('\n');
      console.log(`[elena-tool-use] [${conversationId}] Completed in ${round} round(s)`);
      return finalText;
    }

    // If Claude wants to use tools, process each tool_use block
    if (response.stop_reason === 'tool_use') {
      // Add the assistant's response (which contains tool_use blocks) to messages
      messages.push({ role: 'assistant', content: response.content });

      // Extract all tool_use blocks and execute them
      const toolUseBlocks = response.content.filter(block => block.type === 'tool_use');
      const toolResults = [];

      for (const toolUse of toolUseBlocks) {
        console.log(`[elena-tool-use] [${conversationId}] Executing tool: ${toolUse.name}`, JSON.stringify(toolUse.input));

        // Send human-readable status update
        if (onStatus) {
          const status = describeToolUse(toolUse.name, toolUse.input);
          onStatus(status);
        }

        const result = await executeTool(toolUse.name, toolUse.input);

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: result,
        });
      }

      // Add tool results as a user message (per Anthropic's tool_use protocol)
      messages.push({ role: 'user', content: toolResults });

      if (onStatus) onStatus('Analyzing results...');

      // Continue the loop — Claude will process the tool results
      continue;
    }

    // Unexpected stop reason — return whatever text we got
    console.warn(`[elena-tool-use] [${conversationId}] Unexpected stop_reason: ${response.stop_reason}`);
    const textBlocks = response.content.filter(block => block.type === 'text');
    return textBlocks.map(block => block.text).join('\n') || '[No response generated]';
  }

}

// ─── Integration Example ────────────────────────────────────────────────────────
//
// In elena.js, replace the simple anthropic.messages.create() call with:
//
//   import { chatWithTools } from './elena-tool-use.js';
//
//   // Before (simple call):
//   // const response = await anthropic.messages.create({
//   //   model: 'claude-sonnet-4-6',
//   //   max_tokens: 4096,
//   //   system: systemPrompt,
//   //   messages: conversationMessages,
//   // });
//   // const assistantMessage = response.content[0].text;
//
//   // After (with Monday.com tool access):
//   const assistantMessage = await chatWithTools(
//     conversationId,
//     userMessage,
//     systemPrompt,
//     previousMessages  // the conversation history array
//   );
//
// The chatWithTools function handles the entire tool-use loop internally
// and returns the final text response, so the rest of elena.js doesn't
// need to change. Elena's system prompt should mention that she has access
// to Command Center data so she knows to use the tools when relevant.
//
