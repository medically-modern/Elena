// medical-necessity.js — lets Elena read one or more uploaded PDFs and do
// whatever the user asks with them.
//
// Sends the PDFs to Claude as native document blocks (Claude reads PDFs directly,
// including scanned faxes — page images, signatures, stamps). The MN rubric +
// submit_mn_evaluation tool are made available but NOT forced: Elena only returns
// the structured Medical Necessity table when the user actually asks for an MN
// review. For any other request (summarize, extract, answer a question), she
// replies in plain markdown. This keeps the door open for other PDF tasks later.

import Anthropic from '@anthropic-ai/sdk';
import { MN_RUBRIC, MN_TOOL } from '../config/mn-rubric.js';

const anthropic = new Anthropic();
// Strong model — clinical judgment, not a cheap call.
const MN_MODEL = process.env.MN_MODEL || process.env.SONNET_MODEL || 'claude-sonnet-4-6';

const DOC_REVIEW_SYSTEM = `You are Elena, Medically Modern's assistant. The user has attached one or more documents (PDFs — often clinical charts, orders, letters, or faxes). Read them carefully and do exactly what the user asks.

If the user asks you to evaluate Medical Necessity — or the request is clearly an MN / clinical-eligibility review of a chart, clinicals, order, or MN letter — call the submit_mn_evaluation tool and apply the rubric below. For ANY other request (summarize, extract fields, answer a question, compare documents), answer directly in clean markdown and do NOT call the tool.

Always quote documents verbatim when you cite them.

${MN_RUBRIC}`;

/**
 * Review one or more PDFs against the user's instruction.
 * @param {Array<{filename?: string, base64: string}>} pdfs
 * @param {string} [message] - the user's instruction (what to do with the docs)
 * @returns {Promise<{type:'mn-evaluation'|'text', ...}>}
 */
export async function reviewDocuments(pdfs, message) {
  if (!Array.isArray(pdfs) || pdfs.length === 0) throw new Error('No documents provided');
  const instruction = (message && String(message).trim()) ||
    'Review the attached document(s) and tell me what you find.';

  const content = pdfs.map(p => ({
    type: 'document',
    source: { type: 'base64', media_type: 'application/pdf', data: p.base64 },
  }));
  content.push({ type: 'text', text: instruction });

  const response = await anthropic.messages.create({
    model: MN_MODEL,
    max_tokens: 8192,
    system: DOC_REVIEW_SYSTEM,
    tools: [MN_TOOL],
    tool_choice: { type: 'auto' },
    messages: [{ role: 'user', content }],
  });

  const toolUse = response.content.find(b => b.type === 'tool_use' && b.name === 'submit_mn_evaluation');
  if (toolUse) {
    return {
      type: 'mn-evaluation',
      filename: pdfs.map(p => p.filename).filter(Boolean).join(', ') || null,
      ...toolUse.input,
    };
  }

  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  return { type: 'text', text: text || '(no response generated)' };
}
