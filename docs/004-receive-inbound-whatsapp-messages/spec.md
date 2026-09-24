# Spec 004: Receive inbound WhatsApp messages (Evolution API webhook)

- **Status:** Implemented
- **Date:** 2026-09-24
- **Repository:** desk-health-agent-api
- **Source description:** "US-01 · Receive inbound WhatsApp messages (from docs/MVP.md, lines 33-47)"
- **PRD references:** §07 FR-01, FR-04; §09 Architecture (webhook receiver, inbox dedup, queue); §10 Core data model (`inbox_message`, `audit_event`); §11 Privacy & compliance; §12 NFRs (webhook ack p99 < 500 ms, zero lost inbound messages, trace per conversation)
- **Related specs:** docs/003-initial-data-model/spec.md (D8 Postgres enums, D14 encrypted payload, D15 `UNIQUE (tenant_id, external_id)`, D17 `attempts`/`last_error`, D21 timestamps, D22 explicit names, D28 delete rules; D2 deferred `audit_event` to this kind of spec), docs/002-readiness-health-check/spec.md (D7 Zod, non-blocking boot), docs/MVP.md (US-01, deviation D2 Evolution API)

## Summary

Adds the first inbound path of the api. Evolution API posts WhatsApp events to `POST /webhooks/evolution`. The api authenticates the request with a shared secret header, resolves the tenant from the Evolution instance, normalizes the message, and stores it once in `inbox_message` (encrypted) together with an `audit_event`. It then enqueues a BullMQ job for the conversation and answers without waiting on any AI. A cron sweep re-enqueues rows the webhook couldn't publish, so no stored message is lost.

## Scope

**In scope**
- `POST /webhooks/evolution` for `messages.upsert` events: auth, validation, tenant resolution, normalization, dedup, persistence, audit, enqueue.
- `tenant.evolution_instance` column (instance → tenant mapping).
- `inbox_message.trace_id` column.
- `audit_event` table, entity and a small insert-only audit service.
- BullMQ wiring (`@nestjs/bullmq`) and the `inbound-messages` queue with job contract `schema_version: 1`.
- Relay sweep (`@nestjs/schedule`) that re-enqueues stuck inbox rows, with dead-lettering after 5 attempts.
- `EVOLUTION_WEBHOOK_SECRET` env var.
- Unit tests and e2e tests against the docker-compose Postgres and Redis.

**Out of scope**
- The job consumer, per-conversation ordering, debounce and conversation state (US-03). Until US-03 lands, jobs wait in the queue.
- Sending replies, including the "please send text" reply for unsupported media (US-02 and later stories).
- Creating `patient` rows or checking consent (US-10).
- L1 emergency screen (US-05). This spec performs no AI step. L1 must run in the consumer before anything else (rule 2).
- Media download, transcription and storage (FR-05 is P1).
- Retention of inbox payloads and audit rows (US-14).
- Admin endpoints to set `tenant.evolution_instance` (set by seed or SQL in the MVP).
- Webhook rate limiting and readiness checks for BullMQ or Evolution.

## Context

Verified in the repo:

- `inbox_message` exists (`src/shared/messaging/inbox-message.entity.ts`, extends `MessageRecord` in `message-record.ts`): `tenant_id NOT NULL`, `external_id`, `event_type`, encrypted `payload bytea` (`encryptedJson` transformer), `published_at`, `attempts`, `last_error`, timestamps, `UNIQUE (tenant_id, external_id)` named `uq_inbox_message_tenant_external_id`, and a partial index `ix_inbox_message_unpublished (created_at) WHERE published_at IS NULL`.
- `tenant` (`src/modules/tenant/tenant.entity.ts`) has `name`, `timezone`, `locale`, `policies`. There is no channel or instance field.
- `src/shared/crypto/field-encryption.ts` exports `encrypt(Buffer)` / `decrypt(Buffer)` (AES-256-GCM, versioned). `encrypted.transformer.ts` exports `encryptedString` and `encryptedJson`.
- `src/config/env.schema.ts` validates env with Zod (4.6). `REDIS_HOST`/`REDIS_PORT` exist. `RedisModule` exports one shared ioredis client (`REDIS_CLIENT`).
- `DatabaseModule` uses `manualInitialization: true` with a background connector (spec 002), so the DataSource may not be initialized when a request arrives.
- Migrations are hand-written, run with the TypeORM CLI (`npm run migration:*`). The only migration is `1790274278271-InitialDataModel.ts`.
- There's no request validation library, no controller other than health, no queue library and no scheduler installed (`package.json`).
- `@nestjs/*` companion packages must stay on the NestJS 11 lines. Their 12.x releases are ESM-only and don't load under Jest here (CLAUDE.md).
- `test/data-model.e2e-spec.ts` creates a throwaway `<POSTGRES_DB>_e2e_data_model` database, runs migrations and asserts entity/schema parity.

## Constraints

- **Rule 7 (tenant isolation):** the tenant is resolved before any write, and every row, job and log context carries `tenant_id`.
- **Rule 8 (LGPD):** message content, JIDs/phone numbers and push names are never logged. The inbox payload is encrypted at rest (spec 003 D14). Job content in Redis is encrypted (D8). `last_error` never contains payload data (spec 003 D17).
- **Rule 9 (audit):** each stored inbound event emits an `audit_event` in the same transaction (D19–D24).
- **Rule 2 (L1 on every inbound message):** no AI runs here. The consumer (US-03/US-05) must run L1 first. Nothing in this spec may hand a message to any other processing path.
- **PRD §12:** the webhook ack must not wait on the AI (p99 < 500 ms), and zero stored inbound messages may be lost.
- **Contract rules (root CLAUDE.md):** the queue message carries `tenant_id`, a conversation identifier, a trace id and `schema_version`, and is validated from one Zod schema. Consumers must be idempotent.
- **MVP deviation D2 (docs/MVP.md):** Evolution API replaces the WhatsApp Cloud API. The Evolution message id (`data.key.id`) takes the role of `wamid`.

## Decisions

Every technical choice in this spec comes from this table. All decisions were made by the user.

| ID | Question | Options considered (trade-offs) | Decision (user's choice) | Status |
| --- | --- | --- | --- | --- |
| D1 | Where US-01 stops | **Persist only**: small; nothing consumes until US-03. **Persist + enqueue now**: flow end to end sooner; pulls queue decisions in. **Persist + in-process event**: hook without a queue; not durable. | Persist **and** enqueue now | Decided |
| D2 | Webhook authentication | **Secret header**: constant-time compare, not in URLs; needs Evolution header config. **Secret in URL path**: any version; leaks into access logs. **Body `apikey`**: no config; powerful credential in every body. **Header + IP allowlist**: defense in depth; proxy config, brittle. | Shared secret in a request header, compared in constant time | Decided |
| D3 | Instance → tenant mapping | **New table**: multi-number, multi-provider; extra entity. **Column on tenant**: smallest; one number per tenant. **Env map**: no migration; redeploy per tenant. | Column on `tenant`: `evolution_instance` | Decided |
| D4 | Where the secret lives | **One global env var**: simple; shared blast radius. **Per instance, encrypted**. **Per instance, hashed**. | One global env var | Decided |
| D5 | Queue technology | **BullMQ**: planned; retries, delays, jobId dedup; no per-group ordering in OSS. **Redis Streams**: no dependency; hand-written retries. **Postgres inbox as queue**: one source of truth; diverges from PRD. | BullMQ | Decided |
| D6 | Inbox insert vs enqueue consistency | **Relay from inbox**: crash-safe; poll latency. **Enqueue after commit + relay sweep**: low latency; two paths, duplicates need jobId. **Enqueue after commit only**: can lose messages. | Enqueue after commit, mark `published_at`, plus a relay sweep for rows left unpublished | Decided |
| D7 | Job payload | **Ids only**: no health data in Redis; extra DB read. **Ids + normalized content**: saves a read; content in Redis. | Ids + normalized content | Decided |
| D8 | Protection of job content in Redis (follows from D7 and rule 8) | **Encrypt content field**: nothing readable in Redis; CPU, opaque. **Plaintext, short-lived**: debuggable; plaintext in memory/snapshots. **Revert to ids only**. | Encrypt the content field with the existing AES-256-GCM helper (base64 ciphertext in the job) | Decided |
| D9 | Conversation identifier in the job | **`tenant_id` + remoteJid**: deterministic, no table; JID is a phone identifier. **HMAC of tenant + JID**: opaque, loggable; needs a key. **Defer to US-03**. | `tenant_id` + remoteJid | Decided |
| D10 | BullMQ integration | **`@nestjs/bullmq`**: Nest DI, `@InjectQueue`; must pin to a Nest 11 line. **Plain `bullmq`**: no pinning risk; manual wiring. | `@nestjs/bullmq` (pinned to the Nest 11–compatible line) + `bullmq` | Decided |
| D11 | Job dedup key | **`jobId = inbox_message.id`**. **`jobId = tenant:external_id`**: readable; provider id in key names. | `jobId = inbox_message.id` | Decided |
| D12 | Relay sweep runner | **setInterval provider**: no dependency. **BullMQ repeatable job**: depends on Redis. **`@nestjs/schedule`**: declarative; new dependency (also wanted by US-14); runs in every replica. | `@nestjs/schedule` | Decided |
| D13 | Sweep timing | **10 s / stale > 30 s**. **60 s / 60 s**. **Env-configurable**. | Runs every 10 s; a row is stale when unpublished for more than 30 s | Decided |
| D14 | Sweep concurrency and failures | **SKIP LOCKED, no cap**: never gives up; poison-row loop. **SKIP LOCKED + max attempts**: bounded; manual recovery. | Claims rows with `FOR UPDATE SKIP LOCKED`, increments `attempts`, writes `last_error` (no payload); stops after **5** attempts (dead-letter: row stays unpublished, logged) | Decided |
| D15 | BullMQ job retention | **Remove on complete, keep failed**: minimal data in Redis. **Keep for a window**: longer dedup; longer ciphertext retention. | `removeOnComplete: true`, `removeOnFail: 100` | Decided |
| D16 | Handled Evolution events | **`messages.upsert` only**. **+ `connection.update`**. **+ `messages.update`**. | `messages.upsert` only. Any other event → 200, dropped, logged by event name only | Decided |
| D17 | Unsupported media | **Store as `unsupported`**: patient can get feedback later; no bytes stored. **Ack and drop**: looks like a lost message. **Store full event**: keeps media; minimization issue. | Store and enqueue with kind `unsupported` and the media type only; no media content | Decided |
| D18 | `inbox_message.payload` content | **Normalized only**: minimization, stable shape. **Raw event**: debuggable; includes the apikey and extra data. **Both**. | Normalized only | Decided |
| D19 | Trace id storage | **New `trace_id` column**: loggable, queryable. **Inside encrypted payload**. **Reuse inbox id**. | New `trace_id uuid` column on `inbox_message` | Decided |
| D20 | HTTP status codes | **401/200/503**. **401/404/503**. **401/422/404/503**. | 401 bad or missing secret; 422 malformed body; 404 unknown instance; 503 secret unset or DB unavailable; 200 stored, duplicate, ignored or unhandled event | Decided |
| D21 | Body validation | **Zod (installed)**: no dependency; small pipe. **class-validator**: new deps; split style. | Zod | Decided |
| D22 | Ignored messages (`fromMe`, group `@g.us`, `status@broadcast`) | **Drop, no row**. **Store as ignored, not enqueued**: audit trail; stores unused data. | Stored (normalized, encrypted) with kind `ignored` and `published_at` set at insert; never enqueued | Decided |
| D23 | Route and module | **`modules/whatsapp`, `/webhooks/evolution`**. **`modules/inbound` + shared queue**. **`modules/evolution`**. | `src/modules/whatsapp/` (provider code in `evolution/`), route `POST /webhooks/evolution` | Decided |
| D24 | Tests | Unit; e2e against real Postgres + Redis; concurrent duplicate test; Redis-down recovery e2e. | Unit tests and e2e against real Postgres + Redis. No concurrent-duplicate or Redis-down e2e | Decided |
| D25 | Header and env names | **`x-webhook-secret` / `EVOLUTION_WEBHOOK_SECRET`**. **`x-evolution-secret` / same env**. | Header `x-webhook-secret`, env `EVOLUTION_WEBHOOK_SECRET` | Decided |
| D26 | Queue name and job version | **`inbound-messages`, v1**. **`whatsapp-inbound`, v1**. | Queue `inbound-messages`, `schema_version: 1` | Decided |
| D27 | Secret at boot | **Required, min length**: safe; every env must set it. **Optional; webhook 503 if unset**: easy local dev; runtime-only failure. | Optional in the env schema; the webhook answers 503 when it's unset | Decided |
| D28 | Duplicate detection | **`INSERT … ON CONFLICT DO NOTHING`**: one round trip, no aborted transaction. **Catch 23505**. | `INSERT … ON CONFLICT ON CONSTRAINT uq_inbox_message_tenant_external_id DO NOTHING RETURNING id` (query builder `orIgnore`); no returned row = duplicate | Decided |
| D29 | Enqueue wait in the request | **Timeout ~200 ms, then 200**: fast ack; late add possible. **Fire-and-forget**. **Await fully**: latency follows Redis. | Race `queue.add()` against a 200 ms timeout. On timeout or error, respond 200 and leave the row for the sweep | Decided |
| D30 | Audit for ingestion (rule 9; spec 003 D2 trigger) | **No audit for ingestion**: inbox row is the record; audit in US-10. **Create `audit_event` now**: literal compliance; designed without a domain actor. | Create `audit_event` now and emit one event per stored inbound message | Decided |
| D31 | `audit_event` before/after storage | **Encrypted bytea**: safe for any entity; not queryable. **Plain jsonb**. **jsonb + allowlist**. | Encrypted `bytea` via `encryptedJson` | Decided |
| D32 | Append-only enforcement | **DB trigger (UPDATE and DELETE)**: enforced for all clients; blocks CASCADE. **App only**. **Trigger on UPDATE only**. | `BEFORE UPDATE OR DELETE` trigger that raises | Decided |
| D33 | Ingestion event content | **actor `system`, ids only**. **actor `patient`, ids only**: unverified identity. | `actor_type = system`, `action = 'inbox_message.received'`, `entity_type = 'inbox_message'`, `entity_id` = inbox id, `before = null`, `after = { event_type, trace_id }` | Decided |
| D34 | `audit_event` columns | **PRD §10 set + Postgres enum**. **Same with text + CHECK**. | PRD §10 set with an `audit_actor_type` Postgres enum (see below) | Decided |
| D35 | `audit_event` ↔ tenant with the D32 trigger (conflicts with spec 003 D28 CASCADE) | **FK RESTRICT**: history survives; tenant delete blocked. **Trigger bypass setting**: keeps CASCADE. **No FK**: orphans. | `tenant_id` FK `ON DELETE RESTRICT`. A tenant with audit history can't be deleted until an erasure procedure exists (deviation from spec 003 D28, recorded here) | Decided |
| D36 | Audit code location | **`src/shared/audit/`**. **`src/modules/audit/`**. | `src/modules/audit/` | Decided |

### Product questions

| ID | Question | Answer | Status |
| --- | --- | --- | --- |
| Q1 | Should the patient get a reply to unsupported media? | Stored and enqueued as `unsupported` so a later story can reply from a tenant template (D17). The reply itself is out of scope | Answered |
| Q2 | How is `tenant.evolution_instance` provisioned for the showcase tenant? | By seed or SQL. Admin endpoints are out of the MVP scope of this spec | Answered |

## What will be implemented

**Configuration (`src/config/env.schema.ts`, D25, D27)**
- `EVOLUTION_WEBHOOK_SECRET`: optional string (non-empty when set). The value is never echoed in errors. Add it to `.env.example` with a dev placeholder.

**Data model (one hand-written migration, spec 003 D7/D21/D22)**
- `tenant.evolution_instance text NULL` with `UNIQUE (evolution_instance)` named `uq_tenant_evolution_instance` (D3). Added to `TenantEntity`.
- `inbox_message.trace_id uuid NOT NULL` (D19). Added to `InboxMessageEntity` only (not to `MessageRecord`, so `outbox_message` is unchanged).
- Enum `audit_actor_type`: `agent`, `staff`, `patient`, `system` (PRD §10, D34, spec 003 D8).
- Table `audit_event` (D30, D31, D34, D35): `id uuid PK DEFAULT gen_random_uuid()`, `tenant_id uuid NOT NULL` (FK `fk_audit_event_tenant` **ON DELETE RESTRICT**), `actor_type audit_actor_type NOT NULL`, `actor_id uuid NULL`, `action text NOT NULL`, `entity_type text NOT NULL`, `entity_id uuid NULL`, `before bytea NULL` and `after bytea NULL` (encrypted JSON), `model_version text NULL`, `prompt_version text NULL`, `trace_id uuid NULL`, `created_at timestamptz NOT NULL DEFAULT now()`. No `updated_at` (append-only). Indexes `(tenant_id, created_at)` and `(tenant_id, entity_type, entity_id)`.
- Function and trigger `trg_audit_event_append_only`: `BEFORE UPDATE OR DELETE ON audit_event FOR EACH ROW` raises an exception (D32).
- `down` drops the trigger, function, table, enum and the two columns.

**Audit module (`src/modules/audit/`, D36)**
- `AuditEventEntity` with the `encryptedJson` transformer on `before`/`after`. Registered in `ENTITIES`.
- `AuditService.record(manager: EntityManager, event)`: insert-only. It takes the caller's transaction manager so the audit row commits atomically with the state change (rule 9). No update or delete method.

**Queue (`@nestjs/bullmq`, D5, D10, D15, D26)**
- `BullModule.forRootAsync` builds its connection from `REDIS_HOST`/`REDIS_PORT` (BullMQ needs its own connections, `maxRetriesPerRequest: null`). Queue `inbound-messages` is registered with default job options `removeOnComplete: true`, `removeOnFail: 100`.
- Job contract, one Zod schema (`inbound-message.job.ts`) as the single source for the type (root CLAUDE.md "Contract rules"):
  - `schema_version: 1`
  - `tenant_id: uuid`
  - `inbox_message_id: uuid`
  - `conversation_key: string`, `"<tenant_id>:<remoteJid>"` (D9)
  - `trace_id: uuid`
  - `kind: 'text' | 'button_reply' | 'list_reply' | 'unsupported'`
  - `content: string`, base64 of `encrypt(JSON(normalized message))` (D7, D8)
- Job name `inbound-message`, `jobId = inbox_message.id` (D11).

**WhatsApp module (`src/modules/whatsapp/`, D23)**
- `evolution/evolution-webhook.schema.ts` (D21): a Zod schema discriminated on `event`. For `messages.upsert` it requires `instance` and `data.key.{id, remoteJid, fromMe}`, plus `data.messageTimestamp`. `data.pushName`, `data.messageType` and `data.message` are optional, and unknown fields pass through. Other events need only `event` and `instance`.
- `evolution/evolution-message.normalizer.ts`: a pure function from a validated `messages.upsert` event to `NormalizedInboundMessage` (D18): `external_id` (`data.key.id`), `remote_jid`, `push_name?`, `timestamp`, `kind`, and `text?` or `selection: { id, title }?` or `media_type?`:
  - `ignored` when `fromMe` is true, the JID ends in `@g.us`, or it equals `status@broadcast` (D22).
  - `text` from `conversation` or `extendedTextMessage.text`.
  - `button_reply` from `buttonsResponseMessage` (or `templateButtonReplyMessage`), keeping id and display text.
  - `list_reply` from `listResponseMessage.singleSelectReply.selectedRowId` and the title.
  - `unsupported` for anything else, keeping only the Evolution `messageType` as `media_type` (D17).
- `webhook-secret.guard.ts` (D2, D20, D25, D27): 503 when `EVOLUTION_WEBHOOK_SECRET` is unset. 401 when `x-webhook-secret` is missing or doesn't match. The compare uses `crypto.timingSafeEqual` over SHA-256 digests of both values, so lengths never leak. Guards run before pipes, so authentication happens before the body is parsed or validated.
- `zod-validation.pipe.ts` (D21): 422 with a generic body (issue paths only, never values).
- `evolution-webhook.controller.ts`: `POST /webhooks/evolution`, `@HttpCode(200)`, returns an empty body.
- `inbound-message.service.ts`, `receive(event, traceId)`:
  1. If the DataSource isn't initialized, 503 (D20; spec 002 non-blocking boot).
  2. Event other than `messages.upsert` → 200, log `{ event, trace_id }` only (D16).
  3. Look up the tenant by `evolution_instance`. Not found → 404, log `{ trace_id, reason: 'unknown_instance' }` without the instance name or content (MVP AC2).
  4. Normalize.
  5. In one transaction: `INSERT … ON CONFLICT DO NOTHING RETURNING id` into `inbox_message` (D28), with `event_type = kind`, encrypted normalized `payload`, `trace_id`, and `published_at = now()` when `ignored` (D22). If a row was inserted, `AuditService.record(...)` (D33).
  6. Duplicate (no row returned) → 200, no audit, no enqueue, log `{ tenant_id, trace_id, duplicate: true }` (MVP AC3).
  7. Ignored → 200, no enqueue.
  8. Otherwise, after commit: `queue.add` raced against a 200 ms timeout (D29). On success, `UPDATE inbox_message SET published_at = now() WHERE id = $1 AND published_at IS NULL`. On timeout or error, log `{ tenant_id, inbox_message_id, trace_id, error class }` and return 200 anyway. The sweep recovers the row (D6).
  9. A DB error during steps 3–5 → 503 (Evolution retries; D28 absorbs the repeat).
- Trace id: `crypto.randomUUID()` generated at ingress, before the guard, and put in every log line for the request and in the row, the job and the audit event (MVP AC7).
- `inbound-relay.sweep.ts` (D12, D13, D14): `@Interval(10_000)`. In one transaction it selects up to a batch of rows `WHERE published_at IS NULL AND attempts < 5 AND created_at < now() - interval '30 seconds' ORDER BY created_at FOR UPDATE SKIP LOCKED`. For each row it rebuilds the job (decrypts the payload, re-encrypts the content) with `jobId = id`, then `add`s it. On success it sets `published_at`. On failure it increments `attempts` and sets `last_error` to the error class and message (never payload). A row reaching 5 attempts is logged once as dead-lettered with `{ tenant_id, inbox_message_id, trace_id }`. The sweep skips the run while the DataSource isn't initialized.

**Wiring**
- `AppModule` imports `ScheduleModule.forRoot()`, `BullModule.forRootAsync(...)`, `AuditModule` and `WhatsappModule`.

### Contract impact on desk-health-agent-core

None for `desk-health-agent-core` in the MVP: per docs/MVP.md deviation D1, the AI and the consumer of `inbound-messages` live in this repo. The job schema (`schema_version: 1`) is still a contract, between this producer and the US-03 consumer. It is defined once in Zod and must follow the versioning rules if the core service ever consumes it. The job has `conversation_key` (D9) instead of a `conversation_id`. US-03 decides whether a `conversation` table replaces it, which would be a `schema_version` bump.

### Audit, security and privacy

- One `audit_event` per stored inbound event (including ignored ones), in the same transaction as the inbox row: actor `system`, action `inbox_message.received`, entity `inbox_message`, `after = { event_type, trace_id }` (encrypted), no content (D30–D33).
- `audit_event` is append-only in the database (D32) and blocks tenant deletion (D35).
- Encrypted at rest: `inbox_message.payload` (normalized message, D18), `audit_event.before/after` (D31). Encrypted in Redis: the job `content` (D8).
- **Plaintext by decision:** `conversation_key` in the job contains the WhatsApp JID (a phone-number identifier) in Redis (D9).
- Logs contain only `tenant_id`, `inbox_message_id`, the event name or kind, the trace id, reasons and error classes. Never the body, text, JID, push name, instance name, header value or secret (MVP AC1, AC2, AC4; rule 8).
- Tenant scoping: the tenant comes only from `evolution_instance`, never from the body, and every write carries its `tenant_id` (rule 7).
- **Stored by decision:** ignored messages (own messages, group messages from third parties, status broadcasts) are stored encrypted (D22). This is data that no flow uses, so review it with the DPO and cover it in US-14 retention.

## Execution steps

1. **Dependencies and config.** Depends on: D5, D10, D12, D25, D27.
   - Changes: install `bullmq`, `@nestjs/bullmq` and `@nestjs/schedule` on versions whose peer deps accept `@nestjs/common` 11 and that load as CommonJS under Jest. Add optional `EVOLUTION_WEBHOOK_SECRET` to `env.schema.ts` and `.env.example`, with tests in `env.schema.spec.ts` (absent OK, empty rejected, value never echoed).
   - Verify: `npm run test`, `npx tsc --noEmit -p tsconfig.json`.
2. **Migration and entities.** Depends on: D3, D19, D31, D32, D34, D35.
   - Changes: `src/shared/database/migrations/<ts>-InboundWebhookAndAudit.ts`. `TenantEntity.evolutionInstance`, `InboxMessageEntity.traceId`, `src/modules/audit/audit-event.entity.ts` + `AUDIT_ACTOR_TYPES`, registered in `ENTITIES`.
   - Verify: `npm run migration:run` / `migration:revert` / `migration:run`. Extend `test/data-model.e2e-spec.ts`: no drift for the new columns and table, `audit_event` round-trip with ciphertext on disk, UPDATE and DELETE on `audit_event` raise, deleting a tenant with audit rows fails (RESTRICT), `uq_tenant_evolution_instance` enforced. `npm run test:e2e`.
3. **Audit module.** Depends on: D30, D33, D36.
   - Changes: `src/modules/audit/audit.module.ts`, `audit.service.ts` (+ spec).
   - Verify: unit test that `record` inserts through the given manager and exposes no update or delete. `npm run test`.
4. **Queue wiring and job contract.** Depends on: D5, D7, D8, D9, D10, D11, D15, D26.
   - Changes: `BullModule.forRootAsync` in `AppModule` (or a small `src/shared/queue/` helper if wiring is shared), queue registration in `WhatsappModule`, `src/modules/whatsapp/inbound-message.job.ts` (Zod schema, type, `buildInboundJob` that encrypts the content).
   - Verify: unit tests: schema accepts valid jobs and rejects missing fields; `content` is ciphertext and decrypts to the normalized message; `jobId` equals the inbox id. `npm run test`.
5. **Evolution schema and normalizer.** Depends on: D16, D17, D18, D21, D22.
   - Changes: `evolution/evolution-webhook.schema.ts`, `evolution/evolution-message.normalizer.ts` (+ specs with fixture events for text, extended text, button reply, list reply, audio, image, sticker, fromMe, group, status broadcast, non-upsert event).
   - Verify: `npx jest src/modules/whatsapp`.
6. **Guard and validation pipe.** Depends on: D2, D20, D21, D25, D27.
   - Changes: `webhook-secret.guard.ts`, `zod-validation.pipe.ts` (+ specs: unset secret → 503, missing or wrong header → 401, right header passes, 422 body has no values).
   - Verify: `npm run test`.
7. **Controller and service.** Depends on: D6, D11, D16, D19, D20, D22, D28, D29, D30, D33.
   - Changes: `evolution-webhook.controller.ts`, `inbound-message.service.ts`, `whatsapp.module.ts`, import in `AppModule`.
   - Verify: unit tests with mocks for each branch in "What will be implemented" (unknown instance 404, duplicate 200 without enqueue or audit, ignored stored with `published_at` and not enqueued, enqueue timeout still 200 with the row unpublished, DataSource down 503, logs contain no body fields). `npm run test`.
8. **Relay sweep.** Depends on: D6, D12, D13, D14.
   - Changes: `inbound-relay.sweep.ts` (+ spec), `ScheduleModule.forRoot()` in `AppModule`.
   - Verify: unit tests: only stale, unpublished, `attempts < 5` rows are picked; success sets `published_at`; failure increments `attempts` and writes a payload-free `last_error`; the fifth failure logs a dead-letter once; skipped while the DataSource is down. `npm run test`.
9. **E2E webhook test.** Depends on: D24, steps 1–8.
   - Changes: `test/evolution-webhook.e2e-spec.ts`.
   - Verify: `docker compose up -d && npm run test:e2e`. See the testing plan.
10. **Docs.** Depends on: steps 1–9.
    - Changes: run `/update-claude-md` (new deps, env var, `modules/whatsapp`, `modules/audit`, status line). In `docs/MVP.md`, mark gap G3 as addressed by this spec. Note in spec 003 that D28 no longer holds for `audit_event` (D35).
    - Verify: CLAUDE.md lists BullMQ, `@nestjs/schedule`, `EVOLUTION_WEBHOOK_SECRET` and the new folders.

## Testing plan

Only the approaches chosen in D24.

**Unit (`npm run test`)**
- Env schema: optional secret.
- Normalizer: every kind and every ignored case, and output never contains unexpected fields (D18).
- Zod webhook schema: valid upsert, unhandled event with a minimal body, malformed upsert.
- Guard: 503, 401 (missing, wrong, different length), pass.
- Pipe: 422 message has no input values.
- Service: all branches listed in step 7, with a spy logger asserting no body field, JID, push name or instance name appears.
- Job builder: encrypted content, schema, jobId.
- Sweep: selection, success, failure, dead-letter, DB down.
- Audit service: insert-only through the given manager.

**E2E against docker-compose Postgres and Redis (`npm run test:e2e`)**
- Boots `AppModule`, runs migrations on the test database and seeds a tenant with `evolution_instance`.
- Missing or wrong `x-webhook-secret` → 401, nothing stored.
- Malformed upsert → 422, nothing stored.
- Unknown instance → 404, nothing stored.
- Valid text message → 200. One `inbox_message` row with `trace_id` and `published_at` set, `payload` on disk is ciphertext, one `audit_event` row. One job in `inbound-messages` with `jobId = inbox id`, a valid v1 schema and encrypted content that decrypts to the normalized message.
- Same message posted again → 200, still one row, one audit event, one job.
- Button reply and list reply stored with the selection. Audio stored as `unsupported` and enqueued.
- `fromMe`, group and status broadcast → 200, stored as `ignored` with `published_at` set, no job.
- Non-upsert event → 200, nothing stored.
- The sweep publishes a row inserted directly as unpublished and older than 30 s (calls the sweep method directly).

Concurrency tests against a real Postgres (root CLAUDE.md) apply to holds, bookings, swaps and offers, and this spec touches none of them. A concurrent-duplicate test and a Redis-down e2e were not chosen (D24).

## Assumptions to confirm

- **Evolution API version and payload shape:** assumed v2 with `event: "messages.upsert"`, `instance`, `data.key.{id, remoteJid, fromMe}`, `data.pushName`, `data.messageType`, `data.messageTimestamp` and `data.message.{conversation, extendedTextMessage, buttonsResponseMessage, templateButtonReplyMessage, listResponseMessage}`, one message per event. Confirm against the Evolution version used by the showcase and capture real fixtures.
- **Custom webhook headers:** D2 assumes the Evolution webhook config supports custom headers (for `x-webhook-secret`). If it doesn't, D2 must be revisited.
- **Evolution retry behavior** on 404, 422 and 503 (D20) is unverified. If Evolution retries 404/422 aggressively, a misconfigured instance or a schema change produces retry storms.
- **Webhook base64 media** is assumed to be off in the instance config. With it on, bodies can exceed Express's default JSON limit (100 kb) and fail with 413 before auth.
- **`@lid` JIDs:** newer WhatsApp versions can send `@lid` identifiers instead of phone JIDs. Assumed that `remoteJid` is stable per contact for `conversation_key` (D9).
- **Package versions:** the exact `@nestjs/bullmq` and `@nestjs/schedule` versions compatible with Nest 11 and CommonJS Jest are to be confirmed at install time (step 1).
- **`event_type` values** in `inbox_message` are the normalized kinds (`text`, `button_reply`, `list_reply`, `unsupported`, `ignored`). The `audit_event` indexes `(tenant_id, created_at)` and `(tenant_id, entity_type, entity_id)` and the sweep batch size (e.g. 100) are also still to be confirmed.
- **E2E cleanup:** because of D32 and D35, e2e tests can't delete their tenants or audit rows. The webhook e2e is assumed to use a throwaway database, like `data-model.e2e-spec.ts`.
- **Jobs accumulate** in `inbound-messages` until the US-03 consumer exists. That's acceptable for development, but `removeOnComplete` only applies after processing.

## Implementation notes

Recorded at implementation time. None changes a decision.

- **Versions installed:** `bullmq` 6.3, `@nestjs/bullmq` 11.0.5, `@nestjs/schedule` 6.1 (the last lines with Nest 11 peers; the 12.x companions are ESM-only).
- **BullMQ producer connection:** `maxRetriesPerRequest` keeps ioredis' default instead of `null`. BullMQ only requires `null` for blocking (worker) connections, and a finite value makes `add()` fail during an outage rather than wait in the offline queue. The 200 ms race (D29) bounds the webhook either way.
- **Dedup SQL (D28):** the query builder's `orIgnore()` emits `ON CONFLICT DO NOTHING` without a named target. It's equivalent here: the only other unique key is the random primary key.
- **Shared HTTP helpers:** the Zod pipe and the trace-id middleware/decorator live in `src/shared/http/`, since later endpoints reuse them. The trace id is created by middleware, so it exists before the guard runs.
- **Job lookup helper:** `readInboundJobContent` in `inbound-message.job.ts` decrypts a job's content for the US-03 consumer.
- **Queue error logging:** `InboundPublisher` listens for BullMQ `error` events and logs once per outage. Without a listener, BullMQ prints every reconnect error.
- **Sweep overlap:** a run is skipped while the previous one is still in progress (one process). Across replicas, SKIP LOCKED applies (D14).
- **E2E:** `test/evolution-webhook.e2e-spec.ts` uses a throwaway `<POSTGRES_DB>_e2e_webhook` database and removes the jobs it created from the dev Redis.

## Open items

- None blocking.
- Non-blocking follow-ups: tenant deletion and LGPD erasure procedure for tenants with audit history (D35); DPO review of storing ignored group messages (D22) and plaintext JIDs in job keys (D9); retention of `inbox_message` and `audit_event` (US-14).
