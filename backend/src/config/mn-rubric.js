// mn-rubric.js — the grading rubric for the Evaluate Medical Necessity pass.
//
// Mirrors ingest-staging/medical-necessity-sop.md (the team's source of truth).
// Keep this in sync with that SOP when the LCD/payer policy or coverage language changes.
// Coverage criteria source of truth: LCD L33822 (CGM) and L33794 (pumps) + the payer policy.

export const MN_RUBRIC = `MEDICAL NECESSITY — EVALUATION RUBRIC (apply this when performing an Evaluate MN pass on a clinical document — a faxed chart, progress note, order, or letter — to decide whether THE RECORD PROVES the patient qualifies).

THE GOLDEN RULE
"The patient qualifies" and "the record proves the patient qualifies" are two different things. You only ever act on the second. Most denials are eligible patients whose charts didn't say the right words. If you are assuming, the answer is No. Mark Yes ONLY for proof you can point to in the file and quote verbatim.

HOW TO MARK EACH LINE — Yes / No / Invalid
- Yes — the words are there and they're strong enough to stand on their own.
- No — the chart is silent on it; there is nothing to point to.
- Invalid — the chart gestures at it, but the language is too weak or incomplete to prove it. You've got something, just not enough. When it's Invalid, name exactly what's weak so the request asks for the upgrade, not the whole document again.

QUESTION 1 — DO WE HAVE THE DOCUMENT?
Mark each served script/record: Yes (we have it and it's valid), No (it hasn't arrived), or Invalid (we have something but it's insufficient — wrong dates, missing signature, incomplete order).

QUESTION 2 — DOES IT HAVE THE RIGHT LANGUAGE?
Determine the product (CGM or insulin pump) and the coverage path from the document/order, then evaluate the language lines for that path. Every required line must be Yes for the product to clear.

CGM — INSULIN PATH · INSULIN LANGUAGE LINE
- Yes: meds list shows insulin (e.g. "Lantus 20u qHS, Novolog w/ meals"), or a note "takes 3 injections/day".
- Invalid: "Diabetic, on medication" or "managing with injections" that never actually names insulin; or "started on insulin" with no current dose or meds list to confirm.

CGM — HYPOGLYCEMIA PATH · HYPOGLYCEMIA LANGUAGE LINE
- Yes: multiple level-2 lows (<54 mg/dL) documented despite treatment changes, plus language that the patient benefits from a CGM.
- Invalid: "History of hypoglycemia" / "occasional lows" — no <54 values, not shown as multiple events, no sign the lows persisted after the treatment plan was modified.

INSULIN PUMP · DIABETES EDUCATION LINE
- Yes: documented completion of a diabetes education program.
- Invalid: "Counseled on diet" or "referred to diabetes education" — a discussion or a referral, not completion.

INSULIN PUMP · 3+ INJECTIONS/DAY LINE
- Yes: a regimen showing ≥3 daily injections (basal + mealtime).
- Invalid: "On insulin daily" with no frequency, or a regimen that only adds up to 1–2/day.

INSULIN PUMP · CGM USE LINE
- Yes: documented CGM use or frequent testing (e.g. 4×/day fingersticks).
- Invalid: "Checks sugar sometimes," "owns a glucometer," or "considering a CGM" — nothing showing frequent use.

INSULIN PUMP · BLOOD SUGAR ISSUES LINE
- Yes: a specific glycemic problem — elevated A1c, documented swings, recurrent hypo/hyper.
- Invalid: "Some fluctuations" with no values — or "well controlled," which actively undercuts it.

INSULIN PUMP · LETTER OF MEDICAL NECESSITY ON FILE LINE
- Yes: a signed, dated provider letter that speaks to medical necessity for the pump.
- Invalid: a plain prescription, or a letter that's unsigned/undated or never addresses necessity.

INSULIN PUMP · OUT-OF-WARRANTY (OOW) DATE / ON SCRIPT LINE
- Yes: a date ~4 yrs out establishing out-of-warranty, with the replacement reflected on the order.
- Invalid: "Pump is old" with no date, a date still inside warranty, or OOW noted but the replacement isn't on the script.

INSULIN PUMP · MALFUNCTION LINE
- Yes: a documented reason the device needs replacing or switching (a specific failure).
- Invalid: "Wants a new pump" or "prefers a different system" — preference, not malfunction.

CLINICALS BLOCK
- Confirm clinicals received. Identify the qualifying diabetes Diagnosis. Capture the Last Visit Date.
- MR Expiry = Last Visit Date + 6 months. If the last visit is more than 6 months old, flag it (a stale visit is a common denial driver).

VERDICT
- Established only if every required line for the product/path is Yes.
- Otherwise Not established — and the gap note must say SPECIFICALLY what's missing or weak (a missing script, a named chart-language line, or a stale visit), written so the next step can request exactly the upgrade needed.

OUTPUT
Call submit_mn_evaluation. Produce one row per requirement you evaluated: document presence, each relevant coverage-language line for the product/path, and the last-visit/clinicals checks. For EVERY row:
- evidence = the EXACT text quoted verbatim from the document that your decision rests on. If the document is silent, use "(nothing in document)". If the document is illegible for that item, say "(illegible)".
- decision = Yes / No / Invalid.
- rule = the specific SOP criterion you applied (quote or closely paraphrase the matching rule above).
Be conservative. When in doubt, it is No or Invalid, never Yes.`;

export const MN_TOOL = {
  name: 'submit_mn_evaluation',
  description: 'Submit the structured Medical Necessity evaluation of the reviewed document.',
  input_schema: {
    type: 'object',
    properties: {
      product: { type: 'string', description: 'Best determination of the product at issue: "CGM" or "Insulin Pump" (or "Unclear").' },
      coverage_path: { type: 'string', description: 'The coverage path evaluated, e.g. "Insulin", "Hypoglycemia", or "Insulin Pump".' },
      rows: {
        type: 'array',
        description: 'One row per requirement evaluated.',
        items: {
          type: 'object',
          properties: {
            requirement: { type: 'string', description: 'The requirement / coverage-language line being evaluated (e.g. "Document present", "Insulin language line", "Last visit within 6 months").' },
            evidence: { type: 'string', description: 'EXACT verbatim text quoted from the document that the decision rests on, or "(nothing in document)" / "(illegible)".' },
            decision: { type: 'string', enum: ['Yes', 'No', 'Invalid'], description: 'Yes = present and strong enough; No = chart is silent; Invalid = present but too weak/incomplete.' },
            rule: { type: 'string', description: 'The specific SOP rule / coverage criterion referenced for this decision.' },
          },
          required: ['requirement', 'evidence', 'decision', 'rule'],
        },
      },
      clinicals: {
        type: 'object',
        properties: {
          diagnosis: { type: 'string', description: 'Qualifying diabetes diagnosis found, or "(not found)".' },
          last_visit_date: { type: 'string', description: 'Last visit date as written in the document, or "(not found)".' },
          mr_expiry: { type: 'string', description: 'Last visit date + 6 months, or "(unknown)".' },
          stale_visit: { type: 'boolean', description: 'true if the last visit is more than 6 months old.' },
        },
        required: ['diagnosis', 'last_visit_date', 'stale_visit'],
      },
      verdict: { type: 'string', enum: ['Established', 'Not established'], description: 'Established only if every required line is Yes.' },
      gap_note: { type: 'string', description: 'If Not established: the specific, request-ready note of exactly what is missing or weak. Empty string if Established.' },
    },
    required: ['rows', 'verdict', 'gap_note'],
  },
};
