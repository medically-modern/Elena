// medical-necessity.js — runs the Evaluate MN pass on an uploaded document.
//
// Sends the PDF to Claude as a native document block (Claude reads PDFs directly,
// including scanned faxes — page images, signatures, stamps) and forces a
// structured evaluation via the submit_mn_evaluation tool. The grading rubric
// comes from config/mn-rubric.js (mirrors the team's Medical Necessity SOP).

import Anthropic from '@anthropic-ai/sdk';
import { MN_RUBRIC, MN_TOOL } from '../config/mn-rubric.js';

const anthropic = new Anthropic();
// Use a strong model — this is reasoning-heavy clinical judgment, not a cheap call.
const MN_MODEL = process.env.MN_MODEL || process.env.SONNET_MODEL || 'claude-sonnet-4-6';

/**
 * Evaluate a clinical PDF for Medical Necessity.
 * @param {string} pdfBase64 - base64-encoded PDF bytes (no data: prefix)
 * @param {{filename?: string, coveragePath?: string, product?: string}} [opts]
 * @returns {Promise<object>} structured evaluation (rows, clinicals, verdict, gap_note)
 */
export async function evaluateDocument(pdfBase64, opts = {}) {
  const { coveragePath = null, product = null } = opts;
  const hint = [
    product ? `Product hint: ${product}.` : '',
    coveragePath ? `Coverage path hint: ${coveragePath}.` : '',
  ].filter(Boolean).join(' ');

  const response = await anthropic.messages.create({
    model: MN_MODEL,
    max_tokens: 8192,
    system: MN_RUBRIC,
    tools: [MN_TOOL],
    tool_choice: { type: 'tool', name: 'submit_mn_evaluation' },
    messages: [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
        },
        {
          type: 'text',
          text:
            `Evaluate this document for Medical Necessity per the SOP.${hint ? ' ' + hint : ''}\n\n` +
            'For every row: quote the EXACT text from the document in "evidence" (verbatim), make the Yes/No/Invalid decision, and cite the specific SOP rule in "rule". Apply the Golden Rule — only mark Yes for proof you can point to in the file.',
        },
      ],
    }],
  });

  const toolUse = response.content.find(b => b.type === 'tool_use');
  if (!toolUse) {
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    throw new Error('Model did not return a structured evaluation' + (text ? `: ${text.slice(0, 300)}` : '.'));
  }
  return toolUse.input;
}
