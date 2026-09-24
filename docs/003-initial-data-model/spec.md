# Spec 003: Initial data model (TypeORM entities and migrations)

- **Status:** Ready
- **Date:** 2026-09-24
- **Repository:** desk-health-agent-api
- **Source description:** "create a new spec to build a start data model of this service MVP. The started entities are: tenant - name, timezone, locale, policies / patient - whatsapp_id, name, dob, national_id (encrypted), insurance, consent_at / service - type (consultation / exam / procedure), duration, preparation, price, required_sequence / appointment - patient_id, service_id, range, status, source, external_ref, version / inbox and outbox message - unique external id; event type, payload, published_at. Create a typeorm entities, and build the migrations."
- **PRD references:** §07 FR-02, FR-21, FR-23, FR-25, FR-27; §09 Architecture (webhook inbox dedup, outbox relay, exclusion constraint); §10 Core data model; §11 Privacy & compliance; §12 NFRs (message durability, booking integrity)
- **Related specs:** docs/002-readiness-health-check/spec.md (D3 TypeORM, D6 migrations deferred to "the spec that creates the first table", D7 Zod, D8/D13 non-blocking boot and background connect)

## Summary

Creates the first persistent schema of the api: `tenant`, `patient`, `service`, `appointment`, `inbox_message` and `outbox_message` as TypeORM entities. It wires TypeORM migrations (a DataSource file and npm scripts) and adds one hand-written migration that creates these tables. Identifiers and message payloads are encrypted in the application before they reach Postgres. No endpoints, services or relays are added. Later specs build on these tables.

## Scope

**In scope**
- Six TypeORM entities with explicit snake_case column names.
- Postgres enum types for `service.type`, `appointment.status` and `appointment.source`.
- App-level AES-256-GCM encryption (versioned ciphertext) for `patient.national_id`, `inbox_message.payload` and `outbox_message.payload`, plus an HMAC blind index for `patient.national_id`.
- A `tstzrange` column transformer for `appointment.range`.
- A Zod schema for `tenant.policies`.
- Two new required env variables for the keys.
- The TypeORM DataSource file for the CLI, migration npm scripts, and the first migration (up and down).
- Unit tests for the transformers and schemas, and an e2e that runs the migrations and round-trips each entity against the compose Postgres.
- Refresh `CLAUDE.md`, and amend PRD §10 for the unique WhatsApp id decision (D16).

**Out of scope**
- `professional`, `slot_hold`, `location` and the `(professional_id, tstzrange)` exclusion constraint (D1). These are deferred to the scheduling spec.
- `audit_event` (D2). It is deferred to the first spec that changes state through an endpoint.
- Row-level security (D4).
- Any endpoint, service, repository wrapper, webhook, outbox relay or BullMQ job.
- Key rotation tooling. The format supports it (D11) but no re-encrypt job exists.
- `conversation`, `message`, KB, routing and offer tables.

## Context

Verified in the repo on 2026-09-24:

- `src/shared/database/database.module.ts`: `TypeOrmModule.forRootAsync` with `type: 'postgres'`, `entities: []`, `synchronize: false`, `connectTimeoutMS: 5000`, `manualInitialization: true`. `DatabaseConnector` initializes the DataSource in the background every 5 s (spec 002 D8/D13).
- `src/config/env.schema.ts`: Zod schema with the `POSTGRES_*` and `REDIS_*` variables, `Env` type, and `validateEnv` that never echoes values.
- `package.json`: `typeorm` ^1.1.1 (installed 1.1.1), `@nestjs/typeorm` ^11.0.3, `pg` ^8.23.0 and `zod` ^4.6.5. There are no migration scripts, no DataSource file and no entities.
- `docker-compose.yml`: `postgres:latest`, so Postgres 18 at the time of writing (≥ 13, so `gen_random_uuid()` is built in).
- `src/modules/` holds only `health/`. `src/shared/` holds `database/`, `redis/` and `utils/`.
- `../desk-health-agent-core` contains only a `CLAUDE.md`, with no code reading any table yet.

## Constraints

- **The api owns the schema** (root CLAUDE.md, "Shared infrastructure"). Tables change only through migrations, and `synchronize` stays `false`.
- **Tenant isolation (rule 7):** every table except `tenant` has `tenant_id uuid NOT NULL` referencing `tenant(id)`. Every index that serves a lookup starts with `tenant_id`.
- **LGPD (rule 8, PRD §10–§11):** `national_id` is encrypted at rest. Message content (inbox/outbox payloads) is encrypted at rest. Keys and plaintext values are never logged, and errors from the crypto helpers never include the input.
- **Rule 6 (no double bookings):** not weakened. This spec writes no bookings. The exclusion constraint arrives with `professional` and `slot_hold` in the scheduling spec (D1), and that spec must add it before any booking write path exists.
- **Rule 9 (audit):** no state-changing code path is added, so no `audit_event` is emitted (D2).
- **Appointment status values** come from PRD §10: `booked`, `confirmed`, `cancelled`, `completed`, `no_show`.
- **Locales** come from the root CLAUDE.md: `pt-BR` (default), `en`, `es`.

## Decisions

Every technical choice in this spec comes from this table. All decisions were made by the user.

| ID | Question | Options considered (trade-offs) | Decision (user's choice) | Status |
| --- | --- | --- | --- | --- |
| D1 | `appointment.professional_id` and the rule 6 exclusion constraint | **Defer**: matches the requested list; later migration alters `appointment`. **Minimal professional + FK + constraint**: bigger scope; holds still missing. **Professional + slot_hold**: full rule 6 now; largest scope. | Defer to the scheduling spec. `appointment` has no `professional_id` and no exclusion constraint | Decided |
| D2 | `audit_event` in this spec | **Include**: ready for later specs; designed without a user. **Defer**: no state changes here; must not be forgotten. | Defer | Decided |
| D3 | Primary key type | **UUID v4 (`gen_random_uuid`)**: built in, not guessable; random index inserts. **UUID v7**: ordered; needs PG 18 or app generation. **bigint identity**: compact; enumerable. | UUID v4, `DEFAULT gen_random_uuid()` | Decided |
| D4 | DB-level tenant isolation | **tenant_id FK + app scoping**: simple; a missed filter leaks. **+ RLS**: defense in depth; per-connection tenant setting, role changes. | `tenant_id` FK + application scoping, no RLS | Decided |
| D5 | `national_id` encryption | **App AES-256-GCM transformer**: key stays out of the DB; no SQL search. **pgcrypto**: key sent to the DB. **Column only**: no usable entity until later. | App-level AES-256-GCM via a TypeORM transformer, stored as `bytea` | Decided |
| D6 | National ID lookup | **Blind index (HMAC-SHA256)**: exact lookup and dedup; second secret. **None**: simpler; no dedup. | Add `national_id_hash` blind index, unique per tenant | Decided |
| D7 | Migration workflow | **Hand-written, CLI**: full control; drift risk caught by tests. **Generated, CLI**: less typing; hand edits needed. **Hand-written, run on boot**: conflicts with spec 002 D8. | Hand-written migrations, run with npm scripts via the TypeORM CLI and a DataSource file | Decided |
| D8 | Enum storage | **Postgres ENUM**: typed; hard to remove values. **text + CHECK**: flexible. **Lookup tables**: data-driven; joins. | Postgres ENUM types | Decided |
| D9 | `appointment.range` in TS | **Transformer to `{ start, end }`**: typed; custom parser. **Two columns + generated range**: two sources of truth. **Raw string**: untyped. | `tstzrange` column with a transformer to `{ start: Date; end: Date }`, `[)` bounds | Decided |
| D10 | `appointment.version` | **`@VersionColumn`**: automatic increment on save; explicit WHERE needed for checks. **Manual int**: explicit; easy to forget. | TypeORM `@VersionColumn` (optimistic concurrency) | Decided |
| D11 | Key configuration | **Two required env vars, versioned ciphertext**: rotation-ready format. **No version**: simpler; rotation needs a format change. **Keyring**: rotation now; more config. | `ENCRYPTION_KEY` and `NATIONAL_ID_HMAC_KEY` (base64, 32 bytes), required. Ciphertext carries a 1-byte key version | Decided |
| D12 | `service.price` | **Integer cents + currency**: exact, cheap. **numeric(12,2)**: string handling in TS. **numeric + currency**. | `price_cents integer` (nullable) + `currency char(3)` | Decided |
| D13 | `service.duration` / `required_sequence` | **minutes int + uuid[]**: compact; no FK on array items. **Join table**: FKs; extra table. **jsonb**: flexible; no schema. | `duration_minutes integer` + `required_sequence uuid[]` (ordered prerequisite service ids) | Decided |
| D14 | Inbox/outbox payload storage | **Encrypted bytea**: matches PRD §10; not queryable. **Plain jsonb + retention**: health text in plaintext. **Stripped jsonb**: message table doesn't exist yet. | Encrypted `bytea` (serialized JSON, same AES-256-GCM transformer as D5) | Decided |
| D15 | Inbox/outbox uniqueness and tenant | **tenant NOT NULL, unique (tenant_id, external_id)**: rule 7 consistent; tenant must be resolved first. **Nullable tenant, global unique**. **tenant NOT NULL, global unique**. | `tenant_id NOT NULL`, `UNIQUE (tenant_id, external_id)` | Decided |
| D16 | Uniqueness of `patient.whatsapp_id` | **Non-unique index**: follows PRD §10 (one number, several patients). **Unique per tenant**: simpler lookup; contradicts PRD §10. | `UNIQUE (tenant_id, whatsapp_id)`. The PRD conflict was pointed out, and the user chose to keep it unique for the MVP and amend PRD §10 (parent/child booking out of MVP) | Decided |
| D17 | Inbox/outbox processing columns | **Minimal**: poison rows retry forever. **+ attempts, last_error**: retry and dead-letter support. | Add `attempts integer` and `last_error text` (never contains payload content) | Decided |
| D18 | `patient.insurance` | **jsonb `{provider, plan, member_number}`**: flexible; member number in plaintext. **Columns, member no. encrypted**. **Single encrypted jsonb**. | Plain `jsonb` `{ provider, plan, member_number }` | Decided |
| D19 | `tenant.policies` typing | **Zod schema**: validated on write. **Untyped jsonb**. **TS interface only**. | Zod schema with inferred type, `jsonb NOT NULL DEFAULT '{}'` | Decided |
| D20 | Policy keys in this spec | `cancellation_min_notice_minutes` (FR-25), `hold_ttl_seconds` (FR-21), `reminder_offset_minutes` (FR-30), `offer_ttl_minutes` (FR-31). | `cancellation_min_notice_minutes` and `hold_ttl_seconds` | Decided |
| D21 | Timestamps and deletion | **created_at/updated_at, hard delete**: LGPD erasure is real. **+ soft delete**: recoverable; extra purge path. | `created_at`/`updated_at timestamptz` on every table, hard delete only | Decided |
| D22 | snake_case naming | **Explicit `name:` per column**: no dependency; verbose. **Custom NamingStrategy**. **typeorm-naming-strategies**: unverified with TypeORM 1.x. | Explicit `name:` on every column, join column and table | Decided |
| D23 | Entity layout and tests | **Per-module + migration e2e**. **Central entities + e2e**. **Per-module, unit only**. | Entities per module in `src/modules/<tenant|patient|service|appointment>/`, inbox/outbox in `src/shared/messaging/`. Unit tests for transformers, e2e for migrations and entity round-trips | Decided |
| D24 | `appointment.source` values | `whatsapp_agent`, `staff`, `external_sync`, `import`. | `whatsapp_agent`, `staff`, `external_sync` | Decided |
| D25 | Service identity fields | **name + active**. **name only**. **Exactly the list**. | `name text NOT NULL`, `UNIQUE (tenant_id, name)`, `active boolean NOT NULL DEFAULT true` | Decided |
| D26 | Patient before consent | **`consent_at` nullable**: row at first contact. **NOT NULL**: pre-consent state elsewhere. | `consent_at` nullable. The "no health data before consent" rule is enforced by services later | Decided |
| D27 | Timezone/locale validation | **CHECKs in DB** (locale only; timezone in Zod). **App-only**. | `locale` CHECK IN (`pt-BR`, `en`, `es`) default `pt-BR`. `timezone` is validated as an IANA name by Zod on write | Decided |
| D28 | FK delete behavior | **RESTRICT everywhere**. **CASCADE from tenant and patient, RESTRICT from service**. **CASCADE everywhere**. | `ON DELETE CASCADE` for every `tenant_id` FK and `appointment.patient_id`. `ON DELETE RESTRICT` for `appointment.service_id` | Decided |
| D29 | Patient nullability | **Only whatsapp_id required**. **whatsapp_id + name required**. | `whatsapp_id` and `name` NOT NULL. `dob`, `national_id`, `national_id_hash`, `insurance` and `consent_at` nullable | Decided |

### Product questions

| ID | Question | Answer | Status |
| --- | --- | --- | --- |
| Q1 | Can one WhatsApp number book for several patients (parent/child) in the MVP? | No. Out of MVP (D16). PRD §10 to be amended | Answered |
| Q2 | Default values for `cancellation_min_notice_minutes` and `hold_ttl_seconds` | Not decided. The keys are optional in the schema (see Assumptions), and the features that read them must set defaults | Open (non-blocking) |

## What will be implemented

**Configuration (`src/config/env.schema.ts`, D11)**
- New required variables `ENCRYPTION_KEY` and `NATIONAL_ID_HMAC_KEY`: base64 strings that decode to exactly 32 bytes. Validation errors name the variable, never the value.
- `.env.example` gains dev-only placeholder keys, marked as never to be used outside local development.

**Crypto helpers (`src/shared/crypto/`, D5, D6, D11, D14)**
- `encrypt(plaintext: Buffer): Buffer` / `decrypt(ciphertext: Buffer): Buffer` with AES-256-GCM, a random 12-byte IV and a 16-byte tag. Layout: `version (1 byte) | iv (12) | tag (16) | ciphertext`. The current version is `1`. Decrypting an unknown version or a bad tag throws an error with no input data in it.
- `hmacNationalId(value: string): Buffer`: HMAC-SHA256 with `NATIONAL_ID_HMAC_KEY` over the normalized value (see Assumptions).
- TypeORM transformers built on these: `encryptedString` (for `national_id`) and `encryptedJson` (for payloads). They map `null` ↔ `null`.
- The keys are read once from the validated env. Entities are not Nest providers, so the transformers get the keys through a module-level key holder that is initialized at bootstrap, and in the CLI DataSource and tests (see Assumptions).

**Range transformer (`src/shared/database/`, D9)**
- `tstzRangeTransformer`: `{ start: Date; end: Date }` → `'[start_iso,end_iso)'`, and it parses Postgres's text output back (handles quoted bounds). It rejects `end <= start` on write.

**Enums (D8, D24)**
- `service_type`: `consultation`, `exam`, `procedure`.
- `appointment_status`: `booked`, `confirmed`, `cancelled`, `completed`, `no_show` (PRD §10).
- `appointment_source`: `whatsapp_agent`, `staff`, `external_sync`.
- Each is also exported as a TS `const` array plus a union type, next to its entity.

**Tables** (all with `id uuid PK DEFAULT gen_random_uuid()` (D3), `created_at` and `updated_at timestamptz NOT NULL DEFAULT now()` (D21), and explicit snake_case names (D22))

| Table | Columns | Constraints / indexes |
| --- | --- | --- |
| `tenant` (`src/modules/tenant/`) | `name text NOT NULL`, `timezone text NOT NULL`, `locale text NOT NULL DEFAULT 'pt-BR'`, `policies jsonb NOT NULL DEFAULT '{}'` | `CHECK (locale IN ('pt-BR','en','es'))` (D27) |
| `patient` (`src/modules/patient/`) | `tenant_id uuid NOT NULL`, `whatsapp_id text NOT NULL`, `name text NOT NULL`, `dob date NULL`, `national_id bytea NULL` (encrypted), `national_id_hash bytea NULL`, `insurance jsonb NULL`, `consent_at timestamptz NULL` | FK tenant CASCADE (D28). `UNIQUE (tenant_id, whatsapp_id)` (D16). Partial `UNIQUE (tenant_id, national_id_hash) WHERE national_id_hash IS NOT NULL` (D6). CHECK that `national_id` and `national_id_hash` are both null or both set |
| `service` (`src/modules/service/`) | `tenant_id uuid NOT NULL`, `name text NOT NULL`, `type service_type NOT NULL`, `duration_minutes integer NOT NULL`, `preparation text NULL`, `price_cents integer NULL`, `currency char(3) NOT NULL DEFAULT 'BRL'`, `required_sequence uuid[] NOT NULL DEFAULT '{}'`, `active boolean NOT NULL DEFAULT true` | FK tenant CASCADE. `UNIQUE (tenant_id, name)` (D25). `CHECK (duration_minutes > 0)`, `CHECK (price_cents IS NULL OR price_cents >= 0)` |
| `appointment` (`src/modules/appointment/`) | `tenant_id uuid NOT NULL`, `patient_id uuid NOT NULL`, `service_id uuid NOT NULL`, `range tstzrange NOT NULL`, `status appointment_status NOT NULL DEFAULT 'booked'`, `source appointment_source NOT NULL`, `external_ref text NULL`, `version integer NOT NULL` (`@VersionColumn`, D10) | FK tenant CASCADE, FK patient CASCADE, FK service RESTRICT (D28). `CHECK (NOT isempty(range) AND lower_inc(range) AND NOT upper_inc(range) AND NOT lower_inf(range) AND NOT upper_inf(range))` (the unbounded-range checks were added at implementation, since `{ start, end }` can't represent an open end). Index `(tenant_id, patient_id)`, index `(tenant_id, service_id)`. No exclusion constraint yet (D1) |
| `inbox_message` (`src/shared/messaging/`) | `tenant_id uuid NOT NULL`, `external_id text NOT NULL`, `event_type text NOT NULL`, `payload bytea NOT NULL` (encrypted JSON), `published_at timestamptz NULL`, `attempts integer NOT NULL DEFAULT 0`, `last_error text NULL` | FK tenant CASCADE. `UNIQUE (tenant_id, external_id)` (D15). Partial index `(created_at) WHERE published_at IS NULL` for the relay |
| `outbox_message` (`src/shared/messaging/`) | Same columns as `inbox_message` | Same constraints and indexes |

**Tenant policies (`src/modules/tenant/tenant-policies.schema.ts`, D19, D20)**
- Zod object: `cancellation_min_notice_minutes` (int ≥ 0) and `hold_ttl_seconds` (int > 0). Unknown keys are rejected. The type is inferred and used on `TenantEntity.policies`.
- A timezone Zod validator (IANA name, checked with `Intl.DateTimeFormat`) and a locale enum are exported with the policies schema for future write paths (D27).

**Registration**
- `DatabaseModule` lists the six entities (replacing `entities: []`). `synchronize` stays `false`.
- Each feature module (`TenantModule`, `PatientModule`, `ServiceModule`, `AppointmentModule`, `MessagingModule`) registers its entities with `TypeOrmModule.forFeature`. Modules have no controllers or services yet.

**Migrations (D7)**
- `src/shared/database/data-source.ts`: a standalone `DataSource` for the TypeORM CLI. It loads `.env`, validates it with `validateEnv`, and uses the same connection options and entity list as `DatabaseModule` (shared through one options builder), with `migrations` pointing at `src/shared/database/migrations/*.ts`.
- `src/shared/database/migrations/<timestamp>-InitialDataModel.ts`, hand-written SQL:
  - `up`: create the three enum types, the six tables, constraints and indexes, in FK order.
  - `down`: drop everything in reverse order, including the enum types.
- npm scripts: `migration:run`, `migration:revert`, `migration:create`, `migration:show`.

### Contract impact on desk-health-agent-core

None now. No queue message or tool endpoint changes, and core reads none of these tables. Values fixed here will show up in future tool payloads (UUID ids (D3), the `appointment_status` and `appointment_source` values (D24), and the `{ start, end }` range shape (D9)), so the scheduling tools spec must put them into the shared schema.

### Audit, security and privacy

- No state-changing code path, so no `audit_event` (D2).
- Encrypted at rest in the app: `patient.national_id`, `inbox_message.payload` and `outbox_message.payload` (D5, D14). Blind index: `patient.national_id_hash` (D6).
- **Stored in plaintext by decision:** `patient.name`, `patient.dob`, `patient.whatsapp_id` and `patient.insurance`, including `member_number` (D18). PRD §11 asks for "field-level encryption for identifiers". `member_number` is an identifier left in plaintext by the user's choice, so revisit it with the DPO.
- `last_error` must never contain payload or patient data (D17). This is enforced by the future relays and noted in the entity doc comment.
- Keys never appear in logs, errors or the migration file. Crypto errors carry no input.
- Every non-tenant table has `tenant_id NOT NULL` (rule 7). There's no RLS (D4).

## Execution steps

1. **Encryption keys in config.** Depends on: D11.
   - Changes: add `ENCRYPTION_KEY` and `NATIONAL_ID_HMAC_KEY` to `src/config/env.schema.ts` (base64 → 32 bytes). Update `env.schema.spec.ts` and `.env.example`.
   - Verify: `npx jest src/config` covers missing key → error, wrong length → error, and a message that doesn't echo the value.
2. **Crypto helpers and transformers.** Depends on: D5, D6, D11, D14.
   - Changes: `src/shared/crypto/` (AES-GCM encrypt/decrypt, HMAC, key holder, `encryptedString` and `encryptedJson` transformers) with specs.
   - Verify: `npx jest src/shared/crypto` covers the round-trip, a random IV (two encryptions differ), a tampered tag → throws, an unknown version → throws, null passthrough, a deterministic HMAC, and normalization.
3. **Range transformer.** Depends on: D9.
   - Changes: `src/shared/database/tstzrange.transformer.ts` + spec.
   - Verify: unit tests for to/from, quoted Postgres output, and `end <= start` rejected.
4. **Entities, enums and tenant policies schema.** Depends on: D3, D8, D10, D12, D13, D16, D18–D29.
   - Changes: entities in `src/modules/{tenant,patient,service,appointment}/` and `src/shared/messaging/`, feature modules with `forFeature`, `tenant-policies.schema.ts` + spec, the entity list in `DatabaseModule` and imports in `AppModule`.
   - Verify: `npx tsc --noEmit -p tsconfig.json` and `npm run test` (the policies schema rejects unknown keys and negative values, and the timezone validator rejects `Mars/Olympus`).
5. **DataSource file, migration scripts and initial migration.** Depends on: D7, step 4.
   - Changes: `src/shared/database/data-source.ts`, a shared options builder used by `DatabaseModule`, `src/shared/database/migrations/<ts>-InitialDataModel.ts`, and the npm scripts in `package.json`.
   - Verify: with `docker compose up -d`, `npm run migration:run` creates the tables (`\d+` in psql), `npm run migration:revert` drops them all, and a second `migration:run` succeeds.
6. **Migration and entity e2e.** Depends on: D23, step 5.
   - Changes: `test/data-model.e2e-spec.ts`. It runs migrations on the compose Postgres, then round-trips each entity through TypeORM, checks the constraints, and reverts.
   - Verify: `npm run test:e2e` covers the cases in the Testing plan.
7. **Docs.** Depends on: D16, steps 1–6.
   - Changes: run `/update-claude-md` (new folders, env vars, scripts, status). Amend PRD §10's `patient` note: one WhatsApp number maps to one patient per tenant in the MVP, and parent/child booking is deferred. Edit `../PRD.md` (and `docs/PRD.md`, which is currently an identical copy).
   - Verify: CLAUDE.md lists the migration scripts, `src/shared/crypto/`, `src/shared/messaging/` and the two key variables. The PRD §10 row matches D16.

## Testing plan

- **Unit** (`npm run test`):
  - env schema: the key variables;
  - crypto: round-trip, tamper, version, null, HMAC determinism and normalization;
  - `tstzrange` transformer;
  - tenant policies and timezone/locale validators.
- **e2e** (`npm run test:e2e`, needs `docker compose up -d` and `.env`). Migrations run up, then:
  - Insert and read back each entity. `national_id` and payloads decrypt to the original values, and the raw `SELECT` shows `bytea` with a version byte of `1`, not plaintext.
  - `appointment.range` round-trips as `{ start, end }`, and `version` increments on save.
  - Violations fail:
    - a duplicate `(tenant_id, whatsapp_id)`;
    - a duplicate `(tenant_id, national_id_hash)`;
    - a duplicate `(tenant_id, external_id)` in inbox and in outbox;
    - `locale = 'fr'`;
    - `duration_minutes = 0`;
    - a negative price;
    - an empty or `(]` range;
    - an unknown enum value;
    - deleting a service with appointments (RESTRICT).
  - Deleting a patient removes their appointments. Deleting a tenant removes every child row.
  - `migration:revert` leaves no tables or enum types behind.
- **Static:** `npx tsc --noEmit -p tsconfig.json` and `npm run lint`.
- There are no concurrency tests yet (there's no booking path, D1). There are no contract tests (no contract change).

## Assumptions to confirm

- **National ID normalization for the HMAC:** strip everything except digits (CPF format) before hashing. Other ID types would need a type prefix later.
- **Key holder for transformers:** TypeORM transformers are plain objects, not DI-managed. Keys are loaded into a module-level holder from the validated env at bootstrap, in `data-source.ts` and in tests. Using a transformer before it's initialized throws.
- **Policy keys are optional** in the Zod schema, so `'{}'` is valid. Defaults belong to the features that read them (Q2).
- **`currency` default `'BRL'`**, with `price_cents` nullable when the price is not disclosed.
- **`external_ref`**: nullable text with no uniqueness constraint. The HIS/Calendar adapter spec decides whether `(tenant_id, source, external_ref)` becomes unique.
- **`event_type`**: free text, not an enum, so new event names need no migration.
- **`required_sequence` ids** aren't checked against `service` by the DB (D13). Writers validate them.
- **TypeORM 1.1 CLI:** assumed to support `typeorm-ts-node-commonjs` with `-d src/shared/database/data-source.ts`. Confirm at implementation time.
- **`.env` in `data-source.ts`:** resolved at implementation with Node 24's built-in `process.loadEnvFile()`, so there's no `dotenv` import. The e2e parses `.env` with `util.parseEnv`, because Jest sandboxes `process.env`.
- **Folder names:** `src/shared/crypto/` and `src/shared/messaging/` follow the module-per-concern convention (D23).

## Open items

No open decisions. Follow-ups for later specs:
- **Scheduling spec (D1):** add `professional`, `slot_hold` and `appointment.professional_id`, plus the `(professional_id, tstzrange)` exclusion constraint (`btree_gist`), before any booking write path exists (rule 6).
- **First state-changing spec (D2):** add `audit_event`.
- **Q2:** default values for the tenant policy keys.
- **D18:** revisit plaintext `insurance.member_number` against PRD §11 with the DPO.
