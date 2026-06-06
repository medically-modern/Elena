export const KNOWLEDGE_BASE = `
## MEDICALLY MODERN — BUSINESS CONTEXT

### Company
- DME (Durable Medical Equipment) supplier specializing in CGMs (Continuous Glucose Monitors) and insulin pump supplies
- Products: Dexcom G6, Dexcom G7, Libre 3, Libre 3 Plus, Tandem Mobi, t:slim X2, AutoSoft XC, TruSteel, OmniPod
- Insurance-based fulfillment — patients need prescriptions, prior authorizations, and insurance verification
- Reorder cycle: typically every 90 days (insurance-mandated)

### Team Roster & Routing
- **Corey Deutsch** — CEO, handles sell calls, retention, compliance, strategic decisions
- **Brandon Ellis** — COO/Operations, insurance authority, fulfillment lead, same-or-similar checks, shipping, claims, modifier rules
- **Masheke** — Medical Evaluation / Fax Intake, processes clinicals, CareCarentrix referrals, medical necessity
- **Janelle Beatty** — Pipeline Oversight / Welcome Calls, monitors auth outstanding, escalates blockers, bridges patients and ops
- **Samantha** — Insurance & Benefits, auth submissions via portals (Fidelis, Availity, UHC, fax), documents ref numbers
- **Josh Hoffman** — Engineering / Automation, subscription updates, system changes, Medicaid DVS/claims automation
- **Michelle Coan** — Phone Support, front-line call handling, ePaces/Medicaid portal expertise
- **Christopher Brown** — Deliveries / Store operations, in-store pickups, local deliveries, ostomy supplies
- **Madeline Wichman (Maddie)** — Intern, retroactive auth follow-ups

### Team Routing (who handles what)
- Fax/script received → Masheke posts to #med-mod-onboarding
- Patient calling for status → Janelle handles, escalates to Brandon
- Insurance verification needed → Samantha (documents everything with auth ref numbers)
- Same-or-similar check → Brandon (Noridian portal)
- Subscription/system update → Josh
- In-store pickup/delivery → Christopher Brown
- Sell call / upsell opportunity → Corey
- Compliance question → Corey
- Phone coverage → Michelle (ePaces expertise)
- Clinicals/medical evaluation → Masheke
- Auth submission tracking → Samantha

### Operational Pipeline
Step 1: Referral Receipt — Masheke receives fax, posts document with patient name
Step 2: Medical Evaluation — Masheke processes clinicals, medical necessity
Step 3: Insurance/Auth — Samantha submits auths via portals, documents ref numbers
Step 4: Pipeline Triage — Janelle monitors auth outstanding, escalates blockers
Step 5: Same-or-Similar Check — Brandon verifies clearance dates via Noridian
Step 6: Welcome Call — Janelle conducts, captures patient preferences
Step 7: Fulfillment — Brandon handles shipping + order advancement
Step 8: Confirm Profile — Brandon reviews final details before shipping

## PATIENT COMMUNICATION CATEGORIES

### Tier 1 — Can handle directly:
1. **Order status/tracking** — If tracking exists: share UPS link. If pending auth: "about a week." If waiting on doctor: "sent to Dr. [Name], waiting for signature." If warehouse backlog: "about a week lag."
2. **Simple confirmations** — Context-aware acknowledgment
3. **Address/DOB/insurance info capture** — Structured data capture
4. **Doctor info capture** — Record doctor name, clinic, phone
5. **Refill/reorder** — Confirm product, address, insurance. Check 90-day eligibility.
6. **"Who is this?"** — "This is Medically Modern! You filled out a form for [product]."
7. **Cancel/stop** — Acknowledge, confirm, soft retention if appropriate

### Tier 2 — Triage, human decides:
1. **Insurance questions** — Collect info, route to Samantha/Brandon. No insurance cost: ~$200/month for CGM.
2. **Tech support** — Redirect: Dexcom 1-888-738-3646, Libre/Abbott 1-855-632-8658
3. **Prescription status** — Check system, relay
4. **Cost/pricing** — Varies by patient, route to insurance team

### Tier 3 — Human only:
- Returns/exchanges, billing disputes, frustrated patients, complex insurance, medical distress, family inquiries

## URGENCY SIGNALS
Keywords: "last sensor", "running out", "hospital", "emergency", "frustrated", "can't get through", "nobody picks up", "days left", "expires"

## PRODUCT KNOWLEDGE
- CGM sensors: replacement every 10-14 days depending on brand
- Insurance covers 90-day supplies
- Prior authorizations: 5-10 business days
- Prescriptions require doctor signature
- Dexcom and Libre handle device warranty replacements directly (free)
- Manufacturer support: Dexcom 1-888-738-3646, Libre/Abbott 1-855-632-8658
`;

export default KNOWLEDGE_BASE;
