# MVP — scope for the first working version (V1)

- **Date:** 2026-09-24
- **Status:** Draft. Stories are ready to feed the `create-spec` skill, one or more stories per spec.
- **Sources:** [PRD.md](PRD.md) (§05 journeys, §06 safety, §07 requirements, §10 data model, §11 privacy, §12 NFRs, §15 rollout), root [../../CLAUDE.md](../../CLAUDE.md) and this repo's [../CLAUDE.md](../CLAUDE.md).

This file lists **only** what the first working version must deliver: a patient on WhatsApp can give LGPD consent, ask about the service catalog, find a free slot, book it and cancel it, safely, for one showcase tenant. Anything not listed here is out of the MVP (see [Out of scope](#out-of-scope)).

Use this file as the entry point for any MVP implementation: pick a story, check its dependencies, and run `create-spec` with it. The spec records the technical decisions; this file only lists the questions each spec must ask ("Decisions for the spec"). It never answers them.

---

## 1. MVP requirements

| # | Requirement | Stories |
| --- | --- | --- |
| R1 | Receive and answer WhatsApp messages through **Evolution API**. | US-01, US-02, US-03 |
| R2 | Minimal entities for the full agent flow: `tenant`, `patient`, `service`, `appointment`, `inbox_message`, `outbox_message`. | Done in spec 003. Gaps listed in [§3](#3-deviations-and-gaps) |
| R3 | AI engine **inside this repo (api)**: Gemini API integration, intent router (scheduling, question, LGPD consent), pgvector similarity search over the service catalog, and system prompt templates that forbid diagnosis and force structured JSON output. | US-04 … US-09 |
| R4 | Transactional use cases: LGPD consent via the WhatsApp "Accept" button (sets `patient.consent_at`), availability search, booking, cancellation. | US-10 … US-13 |
| R5 | Finalization and observability: showcase stability, a cron job that anonymizes or deletes raw messages older than 30 days, and global error handling that always sends a safe fallback reply on WhatsApp. | US-14 … US-16 |

Non-negotiable rules 1–10 from the root CLAUDE.md apply to every story. Where a requested item on its own would break one, the matching story adds what the rule requires, marked **(required by rule N)**.

---

## 2. User stories

Format: each story has the actor and goal, the PRD references, its dependencies, testable acceptance criteria, and the open questions its spec must ask the user. Patient-facing text always comes from tenant templates or the service catalog, never from strings in code.

### Epic A · WhatsApp channel (Evolution API)

#### US-01 · Receive inbound WhatsApp messages

**As** a patient, **I want** my WhatsApp messages to reach the receptionist reliably, **so that** nothing I send is lost or handled twice.

- **PRD:** FR-01, FR-04, §09 (webhook inbox dedup), §12 (ack p99 < 500 ms, zero lost messages).
- **Depends on:** spec 003 (`inbox_message`).
- **Acceptance criteria**
  1. A webhook endpoint accepts Evolution API message events and rejects requests that fail authentication, without logging the payload.
  2. The event's tenant is resolved from the Evolution instance. Unknown instances are rejected and logged without content.
  3. The Evolution message id plays the role of `wamid`: the event is stored in `inbox_message` with `UNIQUE (tenant_id, external_id)`. A duplicate delivery returns success and creates nothing new.
  4. The payload is stored encrypted (existing transformer). Logs contain only ids, event type and trace id.
  5. The endpoint answers after persisting and never waits on the AI.
  6. Text messages, button replies and list replies are accepted. Messages sent by the tenant's own number, group messages and status broadcasts are ignored.
  7. A trace id is created at ingress and carried through every later step for that message.
- **Decisions for the spec:** webhook authentication method; how an instance maps to a tenant (column, config, table); which Evolution event types are handled vs ignored; handling of unsupported media (audio, image, sticker) in the MVP.

#### US-02 · Send replies through Evolution API

**As** a patient, **I want** to receive the receptionist's replies, including tappable options, **so that** I can answer quickly.

- **PRD:** FR-01, FR-22, §09 (outbox relay), rule 9.
- **Depends on:** US-01, spec 003 (`outbox_message`).
- **Acceptance criteria**
  1. Every reply is first written to `outbox_message` (encrypted payload) in the same transaction as the state change that produced it, then sent by a relay.
  2. The relay retries failed sends with backoff, increments `attempts`, writes `last_error` without payload data, and never sends the same outbox row twice after a success.
  3. Supports plain text, reply buttons and list messages. When interactive messages are unavailable for the instance, the same options are sent as numbered text and a numbered reply is accepted as the choice.
  4. Evolution API credentials come from validated env/config and are never logged.
- **Decisions for the spec:** relay mechanism (polling, queue, in-process after commit); retry limits and dead-letter behavior; whether interactive buttons are used at all given the Evolution integration type (see [§4](#4-open-questions), Q3).

#### US-03 · Process each conversation in order

**As** a patient who sends several short messages in a row, **I want** them understood together and in order, **so that** replies make sense.

- **PRD:** FR-04, root CLAUDE.md "Queueing" (per-conversation ordering, ~2 s debounce).
- **Depends on:** US-01.
- **Acceptance criteria**
  1. Inbound messages of one conversation are processed one at a time, in arrival order. Different conversations run in parallel.
  2. Messages arriving within the debounce window are processed as one turn.
  3. Redelivery of a job does not produce a second reply (consumers are idempotent).
  4. Conversation state (current step, chosen service, offered slots, hold id) survives between turns and after a restart.
- **Decisions for the spec:** queue technology (BullMQ is planned, not installed); where conversation state lives (Redis, new `conversation` table, both); lock and debounce implementation; conversation expiry.

### Epic B · AI engine (in the api)

#### US-04 · Gemini API integration

**As** the platform, **I want** one Gemini client used by every AI step, **so that** model calls are configurable, bounded and auditable.

- **PRD:** §09 (model per node), §11 (LLM providers), §12 (latency, cost), rule 8.
- **Depends on:** —
- **Acceptance criteria**
  1. API key and model names come from the validated env schema. The api boots without them only if the spec decides so, and the error never echoes values.
  2. Each call has a timeout, a bounded retry and returns a typed result or a typed failure (consumed by US-15).
  3. Model ids are configurable per step (router, answer, guard, embeddings).
  4. The provider plan used has no-training / minimal-retention terms (rule 8). National IDs and dates of birth are never sent in prompts.
  5. Each call records model, prompt version, latency and token usage in logs or metrics, without message content.
- **Decisions for the spec:** SDK vs plain HTTP; Gemini API vs Vertex AI (data terms, region); model per step; timeout and retry values; readiness check impact.

#### US-05 · Emergency screen (L1) (required by rule 2)

**As** a patient describing red-flag symptoms, **I want** to be sent to emergency care immediately, **so that** I don't wait for an appointment.

- **PRD:** J2, §06 L1, §13 emergency recall.
- **Depends on:** US-03, US-02.
- **Acceptance criteria**
  1. Runs on every inbound turn, before the intent router and before any other AI call.
  2. A hit sends the tenant's fixed emergency template (no generated text), flags the conversation and stops the booking flow for that turn.
  3. Keyword lists and the template are per tenant.
  4. An emergency evaluation set passes before the showcase (US-16).
- **Decisions for the spec:** keywords only vs keywords + small model; where keywords and template live; how "flag and notify staff" works without a handoff inbox in the MVP.

#### US-06 · Intent router (triage)

**As** the platform, **I want** each turn classified into a known intent, **so that** the right flow handles it.

- **PRD:** FR-03 (see [§3](#3-deviations-and-gaps), G5), §06 L3.
- **Depends on:** US-04, US-05, US-08.
- **Acceptance criteria**
  1. Classifies into at least: **scheduling**, **question** (service catalog), **LGPD consent**. The output is JSON validated against a schema; invalid output counts as a failure (US-15).
  2. Clinical questions ("what do I have?") are never answered: they go to the approved refusal template plus a booking offer.
  3. Button and list replies with a known payload are routed deterministically, without an LLM call.
  4. Before consent, only the consent flow runs (US-10).
  5. The chosen intent and prompt version are recorded per turn, without message content.
- **Decisions for the spec:** final intent list (sub-intents such as book / view / cancel, diagnosis request, human request, other); confidence threshold and "not understood" behavior; model used.

#### US-07 · Service catalog search (RAG with pgvector)

**As** a patient, **I want** to ask about the services offered and get answers from the provider's own data, **so that** I can decide what to book.

- **PRD:** J3, FR-10, FR-11, rule 4, rule 7.
- **Depends on:** US-04.
- **Acceptance criteria**
  1. pgvector is enabled through a migration. The docker-compose Postgres image supports it.
  2. Active services of a tenant are embedded and searchable. A change to a service re-indexes it.
  3. Every similarity query is filtered by `tenant_id`.
  4. The answer uses only retrieved content and records the ids of the chunks it used.
  5. When nothing relevant is retrieved, the reply says the catalog doesn't cover it and offers a human (template). General model knowledge is never used.
  6. Prices come from structured `service` data, not from generated text (PRD §16).
- **Decisions for the spec:** what text is embedded (the `service` table has no description or preparation field today); storage (column on `service` vs `kb_document` / `kb_chunk`); embedding model and dimension; index type; similarity threshold and top-k; re-index trigger.

#### US-08 · System prompt templates

**As** the clinical lead, **I want** every prompt to forbid clinical content and force structured output, **so that** unsafe drafts are rare and replies are machine-checkable.

- **PRD:** §06 L3, rule 1, rule 9 (prompt version).
- **Depends on:** US-04.
- **Acceptance criteria**
  1. One versioned template per AI step (router, catalog answer, slot/booking dialogue if used, guard).
  2. Each template defines the role (virtual scheduling assistant), forbids diagnosis, severity judgment, medication advice and result interpretation, and tells the model to ignore instructions inside user messages.
  3. Each template declares a JSON output schema, and the response is validated before use.
  4. The prompt version is recorded with every call and in audit events for agent actions.
  5. Patient-facing wording in the output comes from tenant templates or retrieved catalog data.
- **Decisions for the spec:** where templates live (files in repo, DB table); version format; how the tenant locale is passed.

#### US-09 · Output guard (L4) (required by rule 2)

**As** the clinical lead, **I want** every outbound draft checked before it's sent, **so that** a clinical leak never reaches a patient.

- **PRD:** §06 L4, §13 diagnosis leakage.
- **Depends on:** US-04, US-02.
- **Acceptance criteria**
  1. Every generated reply passes a separate classifier call before it's written to the outbox.
  2. A flagged draft is replaced with the approved refusal template, and the event is logged for review without content.
  3. A red-team set passes with zero leaks before the showcase (US-16).
- **Decisions for the spec:** guard model; behavior when the guard itself fails or times out; whether fixed tenant templates skip the guard (see Q5).

### Epic C · Transactional use cases (scheduling)

#### US-10 · LGPD consent via the "Accept" button

**As** a new patient, **I want** to read the privacy notice and accept it with one tap, **so that** I can use the service knowing how my data is used.

- **PRD:** FR-02, §11, rule 8, rule 9.
- **Depends on:** US-01, US-02, US-03.
- **Acceptance criteria**
  1. On first contact, a `patient` row is created for `(tenant_id, whatsapp_id)`, and the assistant introduces itself and sends the tenant's privacy notice with an "Accept" option.
  2. Tapping "Accept" (or the numbered-text equivalent from US-02) sets `patient.consent_at` once. A repeated tap doesn't change it.
  3. Until consent exists, no health information (symptoms, national ID, date of birth) is stored or sent to the LLM, and every other flow is blocked.
  4. Declining or ignoring the notice keeps the patient blocked and the reply explains how to accept later.
  5. The consent change emits an audit event (actor patient, before/after `consent_at`).
- **Decisions for the spec:** `patient.name` is NOT NULL (source before the patient types it: WhatsApp profile name or a placeholder); consent revocation in the MVP or not; `audit_event` table design (see G3).

#### US-11 · Availability search

**As** a patient, **I want** to see the next free times for the service I need, **so that** I can pick one.

- **PRD:** FR-20, J1.
- **Depends on:** US-06, US-07, and the scheduling model (G1, G2).
- **Acceptance criteria**
  1. Given a service (and optionally a preference such as "mornings"), returns the next N free slots in the tenant's time zone, excluding booked and held time.
  2. Slot length comes from `service.duration_minutes`.
  3. Slots are sent as list or button options, plus a "more dates" option.
  4. No slot means an explicit "no availability" reply from a template.
  5. Queries are scoped by `tenant_id`.
- **Decisions for the spec:** where working hours come from (see G1); number of slots and search horizon; preference parsing (LLM extraction vs fixed options).

#### US-12 · Booking

**As** a patient, **I want** to confirm the slot I chose and receive a confirmation, **so that** my appointment is guaranteed.

- **PRD:** FR-21, FR-22, FR-23, rule 5, rule 6, rule 9, §14 concurrency tests.
- **Depends on:** US-10, US-11.
- **Acceptance criteria**
  1. Choosing a slot places a hold with a TTL (`tenant.policies.hold_ttl_seconds`). An expired or foreign hold can't be confirmed.
  2. Before booking, a confirmation summary (service, date, time, professional if any, location, preparation) is shown with Confirm / Change options.
  3. Minimum patient data required by the tenant is collected once and reused (national ID encrypted, blind index kept in sync).
  4. Confirm creates the `appointment` with `source = whatsapp_agent` through a validated service method. The LLM only proposes; it never writes.
  5. Two concurrent confirms for overlapping time can't both succeed: enforced by a Postgres exclusion constraint and proven by a concurrency test against a real Postgres.
  6. Booking emits an audit event and a confirmation reply through the outbox, in the same transaction.
- **Decisions for the spec:** the resource the exclusion constraint applies to (see G1); hold storage (`slot_hold` table vs other); which patient fields are mandatory for the showcase tenant; hold TTL default (spec 003 Q2).

#### US-13 · Cancellation

**As** a patient, **I want** to cancel an upcoming appointment through the chat, **so that** the slot is freed for someone else.

- **PRD:** FR-24, FR-25, J4.
- **Depends on:** US-12.
- **Acceptance criteria**
  1. The patient is identified by the WhatsApp number plus a light second factor before any appointment is listed.
  2. Upcoming appointments are listed as options. The patient picks one and a reason from a fixed list.
  3. Cancellation respects `tenant.policies.cancellation_min_notice_minutes`. Inside the notice window, the reply says so from a template (and offers a human if configured).
  4. Status becomes `cancelled` with an optimistic version check, the time is released, and an audit event plus a confirmation reply are written in the same transaction.
  5. Cancelling an already-cancelled appointment is a no-op with a clear reply.
- **Decisions for the spec:** second factor (date of birth or last national-ID digits, PRD open question 2); where the cancellation reason is stored; notice default (spec 003 Q2).

### Epic D · Finalization and observability

#### US-14 · Raw message retention job (LGPD)

**As** the data protection officer, **I want** raw messages older than 30 days removed automatically, **so that** we keep only the data we need.

- **PRD:** §11 (data minimization, retention), rule 8.
- **Depends on:** US-01, US-02.
- **Acceptance criteria**
  1. A scheduled NestJS job runs at least daily and deletes or anonymizes `inbox_message` and `outbox_message` payloads older than 30 days.
  2. Rows not yet processed or published are never removed.
  3. Deletes run in batches and log only counts per tenant.
  4. The retention period is configurable, with 30 days as default.
  5. Running the job twice is safe.
- **Decisions for the spec:** delete rows vs null the payload (dedup history); scheduler library (`@nestjs/schedule` is not installed); what else is "raw" (conversation state, logs); single-instance execution when several api replicas run.

#### US-15 · Global error handling with a safe fallback reply

**As** a patient, **I want** a clear reply even when something breaks, **so that** I'm never left without an answer.

- **PRD:** §12 availability, rule 10, rule 2.
- **Depends on:** US-02, US-04.
- **Acceptance criteria**
  1. NestJS exception filters return safe HTTP responses with no stack traces or payload data.
  2. Failures in the message worker (LLM timeout, invalid JSON, DB error) are caught outside the HTTP context too, and produce the tenant's fallback template through the outbox.
  3. When the LLM is down, booking and cancellation still work through a menu-based flow (rule 10).
  4. The fallback never duplicates: one fallback per failed turn.
  5. Every failure is logged with trace id, tenant id and error class, never message content.
- **Decisions for the spec:** scope of the menu fallback in the MVP (full booking and cancel vs "try again later / talk to a human"); after how many failures a conversation is escalated; error classes to distinguish.

#### US-16 · Showcase readiness

**As** the product owner, **I want** a stable, repeatable demo, **so that** the first showcase runs without surprises.

- **PRD:** §14, §15 (MVP, one tenant).
- **Depends on:** all stories above.
- **Acceptance criteria**
  1. A seed creates the showcase tenant, its services, schedule and templates, and can be re-run.
  2. A scripted end-to-end conversation (consent → question → availability → booking → cancel) passes against docker-compose Postgres and Redis with a stubbed and with the real LLM.
  3. Small evaluation sets pass: golden conversations, red-team (zero leaks), emergency.
  4. Logs for one conversation can be followed by trace id from webhook to sent reply.
  5. A short runbook explains how to start the stack, connect the Evolution instance and reset demo data.
- **Decisions for the spec:** seed format; size of each evaluation set; whether readiness checks the LLM and Evolution API.

### Suggested spec order

| Order | Stories | Why this order |
| --- | --- | --- |
| 1 | US-01, US-02, US-03 | Everything else needs messages in and out |
| 2 | US-10 + audit table | Consent gates every other flow |
| 3 | US-04, US-08, US-05, US-06, US-09 | AI engine with both safety layers from day one |
| 4 | US-07 | Catalog questions |
| 5 | Scheduling model (G1, G2), US-11, US-12 | Needs the exclusion constraint before any booking write |
| 6 | US-13 | Builds on bookings |
| 7 | US-15, US-14 | Hardening |
| 8 | US-16 | Showcase |

---

## 3. Deviations and gaps

The requested MVP differs from the PRD and root CLAUDE.md in the points below. They are recorded here instead of silently resolved. Each must be confirmed in the spec that touches it.

| # | Topic | PRD / CLAUDE.md says | MVP request | Consequence |
| --- | --- | --- | --- | --- |
| D1 | Where the AI runs | LLM agent in `desk-health-agent-core` (Python, LangGraph). The api never runs the flow. | AI orchestration, LLM and RAG in the api. | The root CLAUDE.md "Who owns what" table and this repo's CLAUDE.md intro must be updated when the first AI spec lands. PRD open question 7 already raises this. The queue contract between repos is not needed for the MVP. |
| D2 | WhatsApp provider | WhatsApp Cloud API: `X-Hub-Signature-256`, `wamid`, Meta templates, 24-hour window (FR-33). | Evolution API. | Webhook auth and message ids follow Evolution. Meta template rules only apply if the instance uses the Cloud API integration. No proactive messages are in the MVP. |
| G1 | Scheduling resource and rule 6 | Exclusion constraint on `(professional_id, tstzrange)` for bookings and holds. `appointment` has no `professional_id` (spec 003 D1). | Minimal entity list has no `professional` or schedule. | Booking (US-12) is blocked until a spec adds the resource (professional or other), its working hours and the exclusion constraint. Rule 6 can't be weakened. |
| G2 | Holds | FR-21 requires a hold with TTL (`slot_hold`). | Not listed. | Needed by US-11 and US-12, and must take part in the exclusion constraint. |
| G3 | Audit | Rule 9: every state change emits an `audit_event`. Deferred by spec 003 D2. | Not listed. | Needed from the first state-changing story (US-10). |
| G4 | Catalog content and embeddings | `kb_document` / `kb_chunk` with pgvector. `service` has name, type, duration, price only. | RAG on the service catalog, minimal entities only. | US-07 needs text to embed and a place to store vectors. The compose image `postgres:latest` has no pgvector. |
| G5 | Intents | FR-03: 9 intents, including emergency, diagnosis request, human request. Rule 2: L1 and L4 always run. | Router with 3 classes. No L1 or L4 listed. | US-05 and US-09 were added. The router spec must decide how cancel, diagnosis requests and "other" are handled. |
| G6 | Symptom routing | Rule 3 and FR-12: routing only from `symptom_routing_rule`. | Not listed. | Without the table, any symptom description may only get a general practitioner / occupational physician offer (rule 3 fallback) and never an LLM-invented route. |
| G7 | Conversation state | `conversation` / `message` tables (PRD §10). | Not listed. | US-03 must choose where state lives. |

## 4. Open questions

| # | Question | Blocks |
| --- | --- | --- |
| Q1 | Who is the showcase tenant, and who approves its emergency keywords, refusal and privacy templates (PRD open question 4)? | US-05, US-09, US-10, US-16 |
| Q2 | Does the showcase schedule per professional, per room, or per service? | G1, US-11, US-12 |
| Q3 | Which Evolution integration will the instance use (WhatsApp Web/Baileys or WhatsApp Business Cloud)? Interactive buttons may not be delivered on every integration, which affects the "Accept" button. | US-02, US-10 |
| Q4 | Is a handoff inbox (FR-40, P0 in the PRD) really out of the MVP? If yes, where do "offer a human" replies and emergency flags go? | US-05, US-07, US-13 |
| Q5 | Rule 2 requires L4 on every outbound message, including fallbacks. When the LLM is down, the guard can't run. Are pre-approved fixed templates exempt? | US-09, US-15 |
| Q6 | Is a Gemini plan with no-training / zero-retention terms available for the showcase (rule 8)? | US-04 |

## Out of scope

Out of the MVP even though the PRD lists some as P0 or v1: handoff inbox and staff console (FR-40–FR-43), symptom routing table (FR-12), view-only appointment listing outside the cancel flow, reschedule (FR-26), reminders and early-slot offers (FR-30–FR-32), proactive/template messages (FR-33), voice notes, insurance checks, service rules and sequences (FR-27), employer bulk booking, external calendars and HIS adapters, the Python core service, L5 review queue.
