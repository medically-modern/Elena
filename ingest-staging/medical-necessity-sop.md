MEDICAL NECESSITY — STAGE SOP (v1.0) — source of truth for how Medically Modern's Medical Evaluation stage handles Medical Necessity. Tool: Command Center → Evaluate. Stage path: Medical Evaluation → Medical Necessity. Coverage criteria source of truth: LCD L33822 (CGM) and L33794 (pumps), plus the patient's actual payer policy. Reviewed quarterly and whenever an LCD or major payer policy updates.

THE GOLDEN RULE - "The patient qualifies" and "the record proves the patient qualifies" are two different things. We only ever act on the second. Most denials at this stage aren't ineligible patients — they're eligible patients whose charts didn't say the right words. If you're assuming, the answer is No. You only mark Yes for proof you can point to in the file.

HOW THE STAGE FLOWS - The sub-stages are: (1) Evaluate MN — decide whether the documentation proves the patient qualifies; (2) Send Request — turn the gap into a specific ask, sent by fax or Parachute; (3) Confirm Receipt (fax only) — confirm the clinic received the faxed request; (4) Chase Clinicals — pursue the actual records, split into two channel-specific buckets: Chase Clinicals — Fax (phone calls) and Chase Clinicals — Parachute (platform messaging). Plus a monitoring loop.

CHANNEL DECIDES THE PATH - What you pick at Send Request sets the route. Fax → Confirm Receipt → Chase Clinicals — Fax (phone calls). Parachute → straight to Chase Clinicals — Parachute (messaging on the platform), with no Confirm Receipt — receipt only needs chasing on a blind fax.

THE MONITORING LOOP - When new records arrive, the patient routes back to Evaluate for a fresh pass, and the attempt counter goes up by one. A case can cycle through several times as documents trickle in.

ESCALATION (overview) - If Confirm Receipt or either Chase Clinicals bucket exhausts its 3 attempts without success, the case goes to Manager Review (Janelle). Evaluate MN and Send Request have no escalation today — one will be built reactively if a need surfaces.

BUCKETS & VIEWS - Each processor works their own bucket. Every processor sees only their own view, scoped to their workflow — Evaluate, Send Request, Confirm Receipt (fax), Chase Clinicals — Fax, or Chase Clinicals — Parachute. They complete the action item, fill it into the Command Center, and the patient drops out of their bucket — moving to whoever owns the next step (or back into the monitoring loop). A rep only ever sees the work that's actually theirs to do right now.

LEADERSHIP OVERSIGHT VIEW - Janelle and senior management get a 10,000-ft view of the whole Medical Evaluation stage — broken out by sub-stage, with days outstanding on each patient. It also surfaces every patient escalated to leadership after failed attempts — the Manager Review queue. The point isn't to work any single bucket — it's to see where patients are aging, where bottlenecks form, and which cases need a senior hand.

SUB-STAGE 1 · EVALUATE MN (the decision engine) - Read the files, then work two questions in order. First, read the Initial Clinical Files: open and review everything we received. Every answer comes from what's actually in the file — not what you assume is there.

EVALUATE MN — QUESTION 1: DO WE HAVE THE DOCUMENT? - Mark each served script/record: Yes — we have it and it's valid; No — it hasn't arrived; Invalid — we have something, but it's insufficient (wrong dates, missing signature, incomplete order). Nothing below a column opens until it's marked Yes. "Not Serving" products are grayed out automatically — you can't pick them.

EVALUATE MN — QUESTION 2: DOES IT HAVE THE RIGHT LANGUAGE? - Opens only once the document is Yes. The Coverage Path is already filled in upstream — you don't choose it. The path decides which language lines appear; mark each Yes / No / Invalid based on what the chart actually says. Every line must be Yes for that product to clear.

EVALUATE MN — FILL THE CLINICALS BLOCK - Confirm Clinicals received. Select the Diagnosis (the qualifying diabetes diagnosis). Enter the Last Visit Date. MR Expiry fills itself — Last Visit + 6 months. If the last visit is more than 6 months old, that's a problem (a stale visit is a common denial driver).

EVALUATE MN — LET THE SYSTEM DECIDE, THEN EXIT - You don't toggle "established" — the banner turns green on its own when everything is Yes and complete. Leave a short, initialed note on what you found. Click Completed Evaluation — the system routes the patient automatically.

EVALUATE MN — OUTCOMES - Established (green) → Final Clinicals unlocks → consolidate the final package → patient advances to Insurance. Not established (red) → Final Clinicals stays locked → patient routes to Send Request so the precise gap can be chased. Your note tells the next person exactly what's missing — be specific.

READING COVERAGE-PATH LANGUAGE: YES / NO / INVALID - Three marks on every language line. Yes — the words are there and they're strong enough to stand on their own. No — the chart is silent on it; nothing to point to. Invalid — the chart gestures at it, but the language is too weak or incomplete to prove it; you've got something, just not enough. When it's Invalid, name exactly what's weak in your note — so Send Request asks for the upgrade, not the whole document over again.

CGM COVERAGE LANGUAGE — INSULIN PATH, INSULIN LANGUAGE LINE - Clears it (Yes): meds list shows insulin (e.g. "Lantus 20u qHS, Novolog w/ meals"), or a note "takes 3 injections/day". Invalid (present but weak): "Diabetic, on medication" or "managing with injections" that never actually names insulin; or "started on insulin" with no current dose or meds list to confirm.

CGM COVERAGE LANGUAGE — HYPOGLYCEMIA PATH, HYPOGLYCEMIA LANGUAGE LINE - Clears it (Yes): multiple level-2 lows (<54 mg/dL) documented despite treatment changes, plus language that the patient benefits from a CGM. Invalid (present but weak): "History of hypoglycemia" / "occasional lows" — no <54 values, not shown as multiple events, and no sign the lows persisted after the treatment plan was modified.

INSULIN PUMP COVERAGE LANGUAGE — DIABETES EDUCATION LINE - Clears it (Yes): documented completion of a diabetes education program. Invalid (present but weak): "Counseled on diet" or "referred to diabetes education" — a discussion or a referral, not completion.

INSULIN PUMP COVERAGE LANGUAGE — 3+ INJECTIONS/DAY LINE - Clears it (Yes): a regimen showing ≥3 daily injections (basal + mealtime). Invalid (present but weak): "On insulin daily" with no frequency, or a regimen that only adds up to 1–2/day.

INSULIN PUMP COVERAGE LANGUAGE — CGM USE LINE - Clears it (Yes): documented CGM use or frequent testing (e.g. 4×/day fingersticks). Invalid (present but weak): "Checks sugar sometimes," "owns a glucometer," or "considering a CGM" — nothing showing frequent use.

INSULIN PUMP COVERAGE LANGUAGE — BLOOD SUGAR ISSUES LINE - Clears it (Yes): a specific glycemic problem — elevated A1c, documented swings, recurrent hypo/hyper. Invalid (present but weak): "Some fluctuations" with no values — or worse, "well controlled," which actively undercuts it.

INSULIN PUMP COVERAGE LANGUAGE — LETTER OF MN ON FILE LINE - Clears it (Yes): a signed, dated provider letter that speaks to medical necessity for the pump. Invalid (present but weak): a plain prescription, or a letter that's unsigned/undated or never addresses necessity.

INSULIN PUMP COVERAGE LANGUAGE — OOW DATE / ON SCRIPT LINE - Clears it (Yes): a date ~4 yrs out establishing out-of-warranty, with the replacement reflected on the order. Invalid (present but weak): "Pump is old" with no date, a date still inside warranty, or OOW noted but the replacement isn't on the script.

INSULIN PUMP COVERAGE LANGUAGE — MALFUNCTION LINE - Clears it (Yes): a documented reason the device needs replacing or switching (a specific failure). Invalid (present but weak): "Wants a new pump" or "prefers a different system" — preference, not malfunction.

SUB-STAGE 2 · SEND REQUEST - Turn the gap Evaluate found into a clear, specific ask. You're not re-deciding the case — you're getting the missing piece back. Read the case header and the workflow note: the case arrived marked Not Established — the note says exactly what's outstanding (a missing script, a chart-language line, or a stale visit). Write what's missing — specifically — in the on-screen section. This is the heart of the step: spell out exactly what we need, and add any context that helps it land. Be specific: "chart notes showing 3+ injections/day," not "send records." Add context where you have it — what we already hold, the coverage path, anything that tells the clinic precisely what to produce.

SEND REQUEST — DELIVERY - Deliver it the way the context calls for. There's no single channel rule — how you send depends on the case. If we know the facility and how they prefer to receive requests, use that. Common routes are the doctor's fax or the clinic portal (Parachute) — but match the clinic, not a template. Log the attempt — initialed and timestamped (e.g. "[date] C.C. Attempt 1: message to Diane on Parachute"). Precision matters: a vague request comes back wrong or empty and costs the patient another full cycle.

SEND REQUEST — NEXT - Request sent by fax → Confirm Receipt. Request sent by Parachute → straight to Chase Clinicals — Parachute (no Confirm Receipt).

SUB-STAGE 3 · CONFIRM RECEIPT (fax only) - The fast loop, and it only exists for faxed requests. You're chasing acknowledgment that the fax actually landed — not the records. Why this step exists: with a sleepy doctor's office, a named contact and a confirmation on the record put accountability on the clinic. They can't later fall back on "we never got the document" — the name and notes you capture take that excuse off the table. Parachute requests skip this step: a Parachute message goes through the platform, so there's nothing to confirm — those cases go straight to Chase Clinicals — Parachute.

CONFIRM RECEIPT — CADENCE - Up to 3 attempts, 1 business day apart — enforced by the system. You make one attempt, then the system clears the patient from your bucket for 1 business day. They reappear for the next attempt when the wait is up. You don't track the spacing yourself — the bucket only surfaces cases that are actually due.

CONFIRM RECEIPT — WORK THE SCREEN (each attempt) - Review the request — what we asked for, plus the files already on hand. Re-send the fax or call — one question only: "did you receive our request?" Document every attempt clearly: channel, who you reached, and what happened. No need for the attempt number — what matters is that the notes are clear and precise enough that, if this escalates, a manager can follow your efforts and workflow without having to come find you.

CONFIRM RECEIPT — WHEN RECEIPT IS CONFIRMED - Mark it in the system. Don't just stop — select the confirmed option, enter the name and role of whoever received it at the clinic, and add any helpful notes for the next step. That advances the patient to Chase Clinicals — Fax. Next: Confirmed → advances to Chase Clinicals — Fax, which starts 3 business days later. 3 attempts exhausted, no confirmation → routes to Manager Review (Janelle).

SUB-STAGE 4 · CHASE CLINICALS - The slow loop — pursuing the actual records. Split into two channel-specific responsibilities, each its own bucket. Cadence (both buckets): up to 3 attempts, 3 business days apart — enforced by the system. You make one attempt, then the system clears the patient from your bucket for 3 business days — giving the clinic time to produce the documents. They reappear for the next attempt when the wait is up. You don't track the spacing yourself — the bucket only surfaces cases that are actually due.

CHASE CLINICALS — 4a · FAX - For requests sent by fax. These reached Confirm Receipt first. Chase by phone: each attempt is a phone call to the clinic, following up on the faxed request — the ask is the records themselves.

CHASE CLINICALS — 4b · PARACHUTE - For requests sent through Parachute. These come straight from Send Request — no Confirm Receipt. Chase on the platform: each attempt is a message to the contact on Parachute, following up on the records.

CHASE CLINICALS — BOTH BUCKETS, EACH ATTEMPT - Review the request — exactly what's outstanding (e.g. "Medical Records + Insulin Pump Script"). Document every attempt clearly: channel, who you reached, and what happened (the attempt number isn't required, but the notes must be clear enough for a manager to follow if it escalates). Stop as soon as records arrive. Next: records arrive → the monitoring loop routes the patient back to Evaluate MN for a fresh pass (attempt # +1). 3 attempts exhausted, no records → routes to Manager Review (Janelle).

MANAGER REVIEW (escalation) - A case here means the rep couldn't get the job done through the normal loops. Owned by Janelle, with help from the senior team. Triggered by: 3 exhausted attempts on Confirm Receipt or Chase Clinicals without success. What Janelle and the senior team do: (1) Dissect the issue — read the rep's attempt notes and pin down exactly what went wrong (clinic non-response, wrong contact, unclear ask, etc.) — this is why thorough notes on every failed attempt matter; (2) Remediate and advance the patient — do whatever it takes to close the outstanding gap and get the patient moving again, so the patient doesn't stall; (3) Teach the key learnings back to the reps — turn each stall into coaching, so the same mistakes get rarer over time.

ESCALATION MODEL — AT A GLANCE - Confirm Receipt (fax only) → 3 attempts exhausted → Manager Review (Janelle). Chase Clinicals — Fax → 3 attempts exhausted → Manager Review (Janelle). Chase Clinicals — Parachute → 3 attempts exhausted → Manager Review (Janelle). Evaluate MN → no escalation today. Send Request → no escalation today. Evaluate MN and Send Request are intentionally left without an escalation path for now; if a recurring failure mode surfaces, one will be built in reactively.
