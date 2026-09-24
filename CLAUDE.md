# CLAUDE.md — desk-health-agent-api

NestJS service of **Front Desk**, the AI scheduling receptionist on WhatsApp for hospitals, clinics and independent practitioners. This repository owns everything except the LLM agent: the WhatsApp webhook (signature check, `wamid` dedup, persist, enqueue), queueing with per-conversation ordering and debounce, the **scheduling core** (source of truth for holds, bookings, cancels, swaps and early-slot offers, protected by a Postgres exclusion constraint), the typed tool endpoints the Python agent calls (`search_slots`, `hold_slot`, `confirm_booking`, `list_appointments`, `cancel`, `reschedule`), outbound sending (24-hour window, templates, rate limits), calendar/HIS adapters, safety configuration storage, KB admin and the audit trail.

The LLM agent lives in the sibling repository `../desk-health-agent-core` (Python, LangGraph). The api validates every tool call: the model proposes, the api decides.

System-wide rules, contracts and the non-negotiable rules: [../CLAUDE.md](../CLAUDE.md). Product spec: [../PRD.md](../PRD.md). Architecture is in §09 and the data model in §10.

> Status: spec 004. The api connects to Postgres (TypeORM) and Redis (ioredis) and exposes `GET /health` (liveness) and `GET /health/ready` (readiness). The data model has `tenant`, `patient`, `service`, `appointment`, `inbox_message`, `outbox_message` and the append-only `audit_event`. `POST /webhooks/evolution` receives Evolution API messages, stores them once (encrypted) with an audit event and enqueues them on the BullMQ `inbound-messages` queue, and a relay sweep re-enqueues rows left unpublished. Nothing consumes that queue yet (US-03), nothing sends replies (US-02), and there's no `professional`, `slot_hold` or exclusion constraint (they come with the scheduling spec).

> **MVP scope:** [docs/MVP.md](docs/MVP.md) lists the requirements and user stories for the first working version (Evolution API channel, AI engine inside this repo with Gemini and pgvector, consent, availability, booking, cancellation, retention job, fallback handling). Read it before speccing or implementing any MVP feature: pick a story there and feed it to `create-spec`. It also records where the MVP deviates from `../PRD.md` and `../CLAUDE.md` (for example, the AI runs here instead of `desk-health-agent-core`). Treat those as open until the story's spec confirms them.

## Tech stack
<!-- auto:stack:start -->
| Role | Technology |
| --- | --- |
| Runtime & language | Node.js 24 (v24.19, `engines` not declared), TypeScript 5.9 (`strict: true`, `target` ES2023, `module` nodenext, legacy decorators via `experimentalDecorators` + `emitDecoratorMetadata`) |
| Framework | NestJS 11.2 (`@nestjs/common`, `@nestjs/core`), RxJS 7.8, reflect-metadata 0.2 |
| HTTP | Express 5 via `@nestjs/platform-express` 11.2 |
| Config & validation | `@nestjs/config` 4.0 (global `ConfigModule`), Zod 4.6 for the env schema, request bodies (`ZodValidationPipe`) and queue job contracts |
| Data | PostgreSQL via TypeORM 1.1 + `@nestjs/typeorm` 11.0 and `pg` 8.23. Entities with explicit snake_case names, hand-written migrations run through the TypeORM CLI (`typeorm-ts-node-commonjs`), `synchronize: false` |
| Security | Node `crypto`: AES-256-GCM field encryption (versioned ciphertext) and an HMAC-SHA256 blind index, applied through TypeORM column transformers |
| Cache/Queue | Redis via ioredis 5.11 (one shared client), BullMQ 6.3 via `@nestjs/bullmq` 11.0 (own connections) |
| Scheduling | `@nestjs/schedule` 6.1 (`@Interval` relay sweep) |
| Health | `@nestjs/terminus` 11.1 (`GET /health/ready`) |
| Testing | Jest 30.5 + ts-jest 29.4, `@nestjs/testing` 11.2, Supertest 7.3 (e2e) |
| Lint & format | ESLint 9.39 (flat config) + typescript-eslint 8.70 (`recommendedTypeChecked`), Prettier 3.9 via `eslint-plugin-prettier` |
| Build/tooling | Nest CLI 11.0 + `@nestjs/schematics` 11.1, ts-node 10.9, npm 11 (`package-lock.json`) |
| Local infra | Docker Compose (`docker-compose.yml`): PostgreSQL (`postgres:latest`) and Redis (`redis:latest`), with named volumes and healthchecks |

The `@nestjs/*` companion packages are pinned to the NestJS 11 lines (config 4, terminus 11, typeorm 11, bullmq 11, schedule 6). Their 12.x releases are ESM-only and can't be loaded by Jest in this CommonJS project.

**Planned (not installed yet):** pgvector, n8n, WhatsApp Cloud API.
<!-- auto:stack:end -->

## Architecture
<!-- auto:structure:start -->
```
desk-health-agent-api/
├── docs/
│   ├── 001-initial-project-structure/
│   ├── 002-readiness-health-check/
│   ├── 003-initial-data-model/
│   └── 004-receive-inbound-whatsapp-messages/
├── src/
│   ├── config/
│   ├── modules/
│   │   ├── appointment/
│   │   ├── audit/
│   │   ├── health/
│   │   ├── patient/
│   │   ├── service/
│   │   ├── tenant/
│   │   └── whatsapp/
│   │       └── evolution/
│   └── shared/
│       ├── crypto/
│       ├── database/
│       │   └── migrations/
│       ├── http/
│       ├── messaging/
│       ├── redis/
│       └── utils/
└── test/
```

- `docs/`: one folder per feature, numbered `NNN-<slug>/`. Each holds a `spec.md` written with the `create-spec` skill, which records the user's decisions and the execution steps for that feature. `PRD.md` is a copy of `../PRD.md`.
- `docs/001-initial-project-structure/`: `spec.md` for the initial NestJS structure, `GET /health` liveness and the docker-compose Postgres and Redis.
- `docs/002-readiness-health-check/`: `spec.md` for validated config, the Postgres and Redis connections and `GET /health/ready`.
- `docs/003-initial-data-model/`: `spec.md` for the first entities, field encryption and the initial migration (decisions D1–D29).
- `docs/004-receive-inbound-whatsapp-messages/`: `spec.md` for MVP US-01: the Evolution API webhook, inbox dedup, `audit_event`, the BullMQ `inbound-messages` queue and the relay sweep (decisions D1–D36, plus implementation notes).
- `src/`: application source code (Nest `sourceRoot`, compiled to `dist/`). `main.ts` bootstraps the app, enables shutdown hooks and listens on `PORT`. `app.module.ts` is the root module: it loads the global `ConfigModule` (validated by `validateEnv`) and imports `CryptoModule`, `DatabaseModule`, `RedisModule`, `BullModule.forRootAsync` (connection from `REDIS_HOST`/`REDIS_PORT`), `ScheduleModule`, `HealthModule`, the entity modules (`TenantModule`, `PatientModule`, `ServiceModule`, `AppointmentModule`, `MessagingModule`), `AuditModule` and `WhatsappModule`. Code is split into `config/`, `modules/` (one folder per feature module) and `shared/` (infrastructure modules and helpers reused across features).
- `src/config/`: `env.schema.ts` holds the Zod env schema, its inferred `Env` type (use with `ConfigService<Env, true>` and `{ infer: true }`) and `validateEnv`, which fails boot with a readable error that never echoes values. `env.schema.spec.ts` tests defaults, required variables, port coercion, the 32-byte base64 keys and the optional webhook secret.
- `src/modules/appointment/`: `AppointmentModule` registers `AppointmentEntity` (`appointment.entity.ts`). It holds `tenant_id`, `patient_id` (CASCADE) and `service_id` (RESTRICT), a `tstzrange` `range` exposed as `{ start, end }`, the `appointment_status` and `appointment_source` Postgres enums (`APPOINTMENT_STATUSES` and `APPOINTMENT_SOURCES`) and an optimistic `@VersionColumn`.
- `src/modules/audit/`: `AuditModule` registers `AuditEventEntity` (`audit-event.entity.ts`): actor type (`audit_actor_type` enum, `AUDIT_ACTOR_TYPES`), actor id, action, entity type/id, encrypted `before`/`after`, model and prompt version, trace id. The table is append-only (a DB trigger rejects UPDATE and DELETE) and its tenant FK is RESTRICT. `AuditService.record(manager, event)` inserts through the caller's transaction manager so the audit row commits with the state change; it has no update or delete.
- `src/modules/health/`: `HealthModule` (imports `TerminusModule` with its logger off). `health.controller.ts` serves `GET /health` (liveness: 200, empty body, no checks) and `GET /health/ready` (readiness: Postgres `SELECT 1` and Redis `PING`, 1 s timeout each; 200 or 503 with `{ status, details: { postgres, redis } }` as up/down only, failures logged instead of returned). `redis.health.ts` is the custom Redis indicator. Specs sit next to both.
- `src/modules/patient/`: `PatientModule` registers `PatientEntity`. `whatsapp_id` is unique per tenant. `national_id` is encrypted, and a `@BeforeInsert`/`@BeforeUpdate` hook keeps the `national_id_hash` blind index in sync with it. `insurance` is plain `jsonb`, and `consent_at` is nullable.
- `src/modules/service/`: `ServiceModule` registers `ServiceEntity`. It holds `name` (unique per tenant), the `service_type` enum (`SERVICE_TYPES`), `duration_minutes`, `price_cents` + `currency`, `required_sequence uuid[]` and `active`.
- `src/modules/tenant/`: `TenantModule` registers `TenantEntity` (`name`, `timezone`, `locale` with a DB CHECK, `policies` jsonb, `evolution_instance` unique, which maps an Evolution API instance to the tenant). `tenant-policies.schema.ts` holds the Zod schemas for `policies` (strict object), IANA time zones and locales, with a spec next to it.
- `src/modules/whatsapp/`: `WhatsappModule`, the WhatsApp channel (inbound only for now). `evolution-webhook.controller.ts` serves `POST /webhooks/evolution`, guarded by `webhook-secret.guard.ts` (constant-time check of the `x-webhook-secret` header; 503 when `EVOLUTION_WEBHOOK_SECRET` is unset, 401 on mismatch). `inbound-message.service.ts` resolves the tenant from the instance (404 if unknown), inserts into `inbox_message` with `ON CONFLICT DO NOTHING` plus an audit event in one transaction, and enqueues after commit (200 ms bound, 503 on DB errors). `inbound-publisher.ts` adds jobs with `jobId` = inbox id. `inbound-relay.sweep.ts` re-enqueues rows unpublished for over 30 s every 10 s (`FOR UPDATE SKIP LOCKED`, dead-letter after 5 attempts). `inbound-message.job.ts` is the Zod contract of the `inbound-messages` job (`schema_version` 1, content encrypted), and `inbound-message.types.ts` the provider-neutral message shape. Values (queue name, timeouts, limits) are in `whatsapp.constants.ts`. Specs sit next to each file.
- `src/modules/whatsapp/evolution/`: Evolution API specifics. `evolution-webhook.schema.ts` is the Zod schema for `messages.upsert` (other events need only `event` and `instance`). `evolution-message.normalizer.ts` maps an event to `text`, `button_reply`, `list_reply`, `unsupported` (media type only) or `ignored` (own, group and status-broadcast messages). `__fixtures__/` holds the sample events used by unit and e2e tests.
- `src/shared/crypto/`: field encryption. `crypto-keys.ts` is a module-level key holder (transformers live outside DI), filled by the global `CryptoModule` at init, by `data-source.ts` and by tests. `field-encryption.ts` has AES-256-GCM `encrypt`/`decrypt` (layout `version | iv | tag | ciphertext`, errors never echo input) and `hmacNationalId` (digits only). `encrypted.transformer.ts` has the `encryptedString` and `encryptedJson` column transformers for `bytea`.
- `src/shared/database/`: `DatabaseModule` registers the TypeORM Postgres DataSource with `manualInitialization: true`. `DatabaseConnector` (`database-connector.service.ts`) initializes it in the background after boot and retries every 5 s forever, so the api starts even when Postgres is down. `database.options.ts` builds the connection options and the `ENTITIES` list, shared by `DatabaseModule` and `data-source.ts` (the standalone DataSource for the TypeORM CLI, which loads `.env` itself). `tstzrange.transformer.ts` maps `tstzrange` ↔ `{ start, end }` (half-open `[)`).
- `src/shared/database/migrations/`: hand-written TypeORM migrations. `1790274278271-InitialDataModel.ts` creates the three enums and six tables with their constraints and indexes, and `down` drops them all. `1790282957865-InboundWebhookAndAudit.ts` adds `tenant.evolution_instance`, `inbox_message.trace_id`, the `audit_actor_type` enum, the `audit_event` table and its append-only trigger.
- `src/shared/http/`: HTTP helpers reused by controllers. `trace-id.ts` has the middleware that creates a trace id per request (before guards run), `traceIdOf` and the `@TraceId()` parameter decorator. `zod-validation.pipe.ts` validates a body against a Zod schema and answers 422 with issue paths and codes only, never values.
- `src/shared/messaging/`: `MessagingModule` registers `InboxMessageEntity` (which also has `trace_id`) and `OutboxMessageEntity`. Both extend `MessageRecord` (`message-record.ts`): `external_id` unique per tenant, `event_type`, an encrypted `payload`, `published_at`, `attempts`, and `last_error` (never payload data). Each table has a partial index on unpublished rows.
- `src/shared/redis/`: global `RedisModule` exporting one ioredis client under the `REDIS_CLIENT` token (`redis.constants.ts`). `redis.client.ts` builds the client and logs connection state only on up/down transitions. The module quits (or disconnects) the client on shutdown.
- `src/shared/utils/`: small shared helpers. `error-message.ts` turns an unknown error into a loggable message (falls back to the error code for Node's empty-message `AggregateError`), and `errorClass` gives the error class plus Postgres SQLSTATE for logs where the message could quote data.
- `test/`: end-to-end tests. `app.e2e-spec.ts` boots the full `AppModule` and checks `GET /health` and `GET /health/ready` over HTTP with Supertest, **against the docker-compose Postgres and Redis** (needs `docker compose up -d` and `.env`). `data-model.e2e-spec.ts` creates a throwaway `<POSTGRES_DB>_e2e_data_model` database, runs the migrations, asserts that the entities match the schema (no drift), round-trips each entity (checking the ciphertext on disk), checks every constraint and delete rule (including the append-only `audit_event`), then reverts. `evolution-webhook.e2e-spec.ts` boots `AppModule` against a throwaway `<POSTGRES_DB>_e2e_webhook` database and the compose Redis, and covers auth, validation, unknown instance, dedup, every message kind, the queued job and the relay sweep. It removes its jobs from Redis afterwards. `jest-e2e.json` is the Jest config used by `npm run test:e2e` (matches `*.e2e-spec.ts`).
<!-- auto:structure:end -->

## Commands
<!-- auto:commands:start -->
| Command | What it does |
| --- | --- |
| `npm install` | Install dependencies from `package-lock.json` |
| `npm run build` | Compile to `dist/` with the Nest CLI (`nest build`, clears `dist/` first) |
| `npm run start` | Start the app once (`nest start`) |
| `npm run start:dev` | Start in watch mode, rebuilding on change (`nest start --watch`) |
| `npm run start:debug` | Watch mode with the Node inspector attached (`nest start --debug --watch`) |
| `npm run start:prod` | Run the compiled build (`node dist/main`); run `build` first |
| `npm run lint` | ESLint over `{src,apps,libs,test}/**/*.ts`. **Runs with `--fix` and rewrites files** |
| `npm run format` | Prettier `--write` on `src/**/*.ts` and `test/**/*.ts` |
| `npm run test` | Unit tests: Jest over `src/**/*.spec.ts` |
| `npm run test:watch` | Unit tests in watch mode |
| `npm run test:cov` | Unit tests with coverage into `coverage/` |
| `npm run test:debug` | Unit tests in band with `--inspect-brk` for a debugger |
| `npm run test:e2e` | End-to-end tests: `test/**/*.e2e-spec.ts` with `test/jest-e2e.json`. Needs `docker compose up -d` and `.env` (tests hit the real Postgres and Redis) |
| `npm run typeorm` | TypeORM CLI (`typeorm-ts-node-commonjs`) bound to `src/shared/database/data-source.ts`; pass a subcommand after `--` |
| `npm run migration:run` | Apply pending migrations to the database in `.env` |
| `npm run migration:revert` | Revert the last applied migration |
| `npm run migration:show` | List migrations and whether each is applied |
| `npm run migration:create -- src/shared/database/migrations/<Name>` | Create an empty migration file to write by hand |
| `npx jest src/path/to/file.spec.ts` | Run a single unit test file |
| `npx jest -t "name"` | Run tests whose name matches |
| `npx nest g resource <name>` | Scaffold a feature module (module, controller, service, DTOs, spec) |
| `npx nest g module\|controller\|service <name>` | Scaffold a single Nest building block |
| `npx tsc --noEmit -p tsconfig.json` | Type-check without emitting |
| `cp .env.example .env` | Create the local `.env` that docker-compose and the api need (first run only) |
| `docker compose up -d` | Start Postgres and Redis in the background (required by `npm run test:e2e` and `/health/ready`) |
| `docker compose ps` | Show container status; both should report `healthy` |
| `docker compose logs -f <postgres\|redis>` | Follow a container's logs |
| `docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"` | Open a psql shell (variables from `.env`) |
| `docker compose exec redis redis-cli` | Open a Redis CLI |
| `docker compose down` | Stop the containers, keeping data in the named volumes |
| `docker compose down -v` | Stop the containers and **delete** their data volumes (needed after a Postgres major upgrade via `latest`) |
<!-- auto:commands:end -->

## Environment variables
<!-- auto:env:start -->
| Variable | Default | Read in |
| --- | --- | --- |
| `PORT` | `3000` | `src/main.ts` |
| `POSTGRES_HOST` | `localhost` | `src/config/env.schema.ts` → `DatabaseModule` |
| `POSTGRES_PORT` | `5432` | `src/config/env.schema.ts` → `DatabaseModule` |
| `POSTGRES_USER` | none (required) | `src/config/env.schema.ts` → `DatabaseModule`; `docker-compose.yml` (Postgres container) |
| `POSTGRES_PASSWORD` | none (required) | `src/config/env.schema.ts` → `DatabaseModule`; `docker-compose.yml` (Postgres container) |
| `POSTGRES_DB` | none (required) | `src/config/env.schema.ts` → `DatabaseModule`; `docker-compose.yml` (Postgres container) |
| `REDIS_HOST` | `localhost` | `src/config/env.schema.ts` → `RedisModule`, `BullModule` |
| `REDIS_PORT` | `6379` | `src/config/env.schema.ts` → `RedisModule`, `BullModule` |
| `ENCRYPTION_KEY` | none (required, base64 of 32 bytes) | `src/config/env.schema.ts` → `CryptoModule` / `data-source.ts` (AES-256-GCM field encryption) |
| `NATIONAL_ID_HMAC_KEY` | none (required, base64 of 32 bytes) | `src/config/env.schema.ts` → `CryptoModule` / `data-source.ts` (national ID blind index) |
| `EVOLUTION_WEBHOOK_SECRET` | none (optional; unset means the webhook answers 503) | `src/config/env.schema.ts` → `WebhookSecretGuard` (expected `x-webhook-secret` value) |

Copy `.env.example` (committed, dev-only placeholders) to `.env` (git-ignored). `ConfigModule` loads `.env` from the working directory, and the api refuses to boot if a required variable is missing, a port is invalid or a key isn't 32 bytes of base64. Generate keys with `openssl rand -base64 32`. Changing a key makes existing ciphertext and hashes unreadable. `docker compose` also refuses to start without the three required `POSTGRES_*` variables.
<!-- auto:env:end -->

## Conventions

- **Style:** Prettier with single quotes and trailing commas. TypeScript runs in `strict` mode. ESLint's type-checked rules are on; `no-explicit-any` is an error, while `no-floating-promises` and `no-unsafe-argument` are warnings. Run `npm run lint` and `npm run test` before committing.
- **Modules:** one Nest feature module per concern, in its own folder under `src/modules/`. Code reused across features (infrastructure modules, helpers) goes in `src/shared/`. Generate with the Nest CLI so structure and specs stay consistent.
- **Tests:** unit specs sit next to the code as `*.spec.ts`; e2e tests go in `test/` as `*.e2e-spec.ts`. Holds, bookings, swaps and offer acceptance also need concurrency tests against a real Postgres (see the root CLAUDE.md "Testing expectations").
- **Contracts:** queue messages and tool endpoints are shared with `desk-health-agent-core`. Carry `tenant_id`, `conversation_id`, a trace id and `schema_version`, and change both repos together.
- **Language:** code, identifiers, commits and docs in English. Patient-facing text comes from tenant templates or the KB, never hard-coded.

## Maintaining this file

Sections between `<!-- auto:* -->` markers are generated by the `update-claude-md` skill (`/update-claude-md`, defined in [.claude/skills/update-claude-md/SKILL.md](.claude/skills/update-claude-md/SKILL.md)). Edit the text outside the markers by hand, and run the skill after changing dependencies, scripts, folders or env vars.
