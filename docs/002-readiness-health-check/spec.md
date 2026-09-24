# Spec 002: Readiness health check for PostgreSQL and Redis

- **Status:** Ready
- **Date:** 2026-09-24
- **Repository:** desk-health-agent-api
- **Source description:** "create a new spec, to apply a new health route to check the postgresql and redis health."
- **PRD references:** §09 Architecture (PostgreSQL, Redis/BullMQ), §12 Non-functional requirements (99.9% availability for ingestion and the scheduling core; observability)
- **Related specs:** docs/001-initial-project-structure/spec.md (D5 `GET /health` → empty 200, D6 plain controller, D10 container healthchecks, D11 default ports, D12 Redis image defaults)

## Summary

Adds `GET /health/ready`, a readiness route that reports whether the api can reach PostgreSQL and Redis. It returns 200 when both are up and 503 when either is down. To make this possible, the api connects to Postgres (TypeORM) and Redis (ioredis) for the first time, with typed, validated configuration. The existing `GET /health` stays a liveness route with no dependency checks.

## Scope

**In scope**
- `@nestjs/config` with a Zod-validated environment schema for the Postgres and Redis connection variables.
- A TypeORM connection to Postgres (connection only: no entities, no migrations, `synchronize: false`).
- A shared, global `RedisModule` that exposes one ioredis client.
- `GET /health/ready` built with `@nestjs/terminus`: a Postgres ping check and a custom Redis check.
- The api boots even when Postgres or Redis is unreachable, and keeps reconnecting in the background.
- Unit tests with mocked indicators, and e2e tests against the docker-compose Postgres and Redis.
- Refresh `CLAUDE.md` with `/update-claude-md`.

**Out of scope**
- Changing `GET /health`. It keeps spec 001's behavior (D5): 200, empty body, no checks.
- TypeORM entities, migrations, a DataSource CLI file and migration scripts (D6).
- Validating `PORT` through the new schema. `main.ts` keeps reading it as it does today.
- Redis authentication or BullMQ settings (spec 001 D12 still applies).
- Auth or network restrictions on the health routes.

## Context

Verified in the repo on 2026-09-24:

- `src/health/health.controller.ts`: `@Controller('health')` with `@Get() check(): void {}` → 200, empty body. `HealthModule` registers only this controller. `AppModule` imports only `HealthModule`.
- `src/health/health.controller.spec.ts` asserts `check()` returns `undefined`. `test/app.e2e-spec.ts` boots `AppModule` and asserts `GET /health` → 200 with empty text.
- `package.json` dependencies: `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express` (^11), `reflect-metadata`, `rxjs`. No config, ORM, database driver, Redis client, validation or terminus packages.
- `src/main.ts` reads `process.env.PORT ?? 3000` directly and doesn't call `enableShutdownHooks()`.
- `docker-compose.yml` runs `postgres:latest` on `5432:5432` and `redis:latest` on `6379:6379` with no auth. Credentials come from `.env` (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`). `.env.example` holds dev placeholders for those three.
- `tsconfig.json` has `strict: true` with legacy decorators. ESLint's `no-explicit-any` is an error.

## Constraints

- **The api owns the schema** (root CLAUDE.md, "Shared infrastructure"). TypeORM must not create or alter tables, so `synchronize` is `false`. There are no entities in this spec.
- **No secrets in git or logs** (rule 8, spec 001 D8). The password is only in `.env`. Connection errors are logged without credentials or connection strings.
- **Tenant isolation (rule 7)** doesn't apply here: the checks are system-level and touch no tenant data. They must not read any table.
- **No state change**, so no `audit_event` (rule 9).

## Decisions

Every technical choice in this spec comes from this table. All decisions were made by the user.

| ID | Question | Options considered (trade-offs) | Decision (user's choice) | Status |
| --- | --- | --- | --- | --- |
| D1 | Route layout vs existing `GET /health` | **Keep `/health` + add `/health/ready`**: liveness never fails on a DB outage; two routes. **Change `/health` to check deps**: one route; outage fails liveness, which risks restart loops. **`/health/live` + `/health/ready`**: explicit naming; moves the existing route. | Keep `/health` (liveness, unchanged) and add `/health/ready` | Decided |
| D2 | Health framework | **@nestjs/terminus**: built-in aggregation, 503 handling and a TypeORM indicator; no core Redis indicator; new dependency with its own response format. **Plain controller + service**: no dependency, full control, hand-written aggregation and timeouts. | `@nestjs/terminus` (replaces spec 001 D6 for the readiness route) | Decided |
| D3 | Postgres client | **pg only**: minimal, raw SQL, defers ORM choice. **TypeORM**: Nest integration, terminus indicator, migrations; weaker typing, raw SQL for exclusion constraints. **Drizzle**: typed builder, no Nest module or terminus indicator. **Prisma**: strong typing; separate schema language, raw SQL for ranges. | TypeORM (`@nestjs/typeorm` + `typeorm` + `pg`) | Decided |
| D4 | Redis client | **ioredis**: the client BullMQ uses internally, so it can be reused; maintenance mode upstream. **redis (node-redis)**: official and active; BullMQ would still need ioredis. | ioredis | Decided |
| D5 | Config source | **@nestjs/config + URLs**: two variables, duplicates credentials. **@nestjs/config + discrete variables**: reuses `POSTGRES_*` from `.env`; more variables. **process.env directly**: no dependency, no central validation. | `@nestjs/config` with discrete variables | Decided |
| D6 | TypeORM setup scope | **Connection only**: smallest change; migrations deferred to the first-table spec. **Connection + migrations wiring**: ready for tables; more to review for no immediate use. | Connection only, `synchronize: false`, no entities | Decided |
| D7 | Config validation at startup | **Zod**: typed schema, clear boot errors; may set the precedent for DTO validation. **Joi**: ConfigModule's documented option, config-only. **class-validator**: same library as Nest DTOs, more boilerplate. **None**: no dependency, runtime connection errors instead. | Zod | Decided |
| D8 | Startup when a dependency is down | **Boot anyway, ready = 503**: api start is decoupled from infra; retries must be non-fatal. **Fail boot after retries**: surfaces misconfiguration immediately; api can't start before Postgres. | Boot anyway: `/health` 200, `/health/ready` 503 until dependencies are back | Decided |
| D9 | `/health/ready` body | **Terminus default JSON**: most detail, may leak hostnames or driver errors. **Status code only**: leaks nothing; needs logs to debug. **Up/down per dependency, no errors**: middle ground; needs custom output. | Up/down per dependency, error messages stripped from the body and logged instead | Decided |
| D10 | Per-check timeout | **1 s**: fast failure; may flap under load. **3 s**: tolerant; probe timeout must be > 3 s. **Configurable via env**: tunable; one more variable. | 1 s per check (fixed) | Decided |
| D11 | Where the ioredis client lives | **Shared `RedisModule`**: global, reusable by BullMQ and locks later; one extra module. **Inside HealthModule**: fewer files; must be extracted later. | Shared global `RedisModule` in `src/redis/` | Decided |
| D12 | Test approach | **Unit mocks + real e2e**: covers the mapping and the real wiring; e2e needs `docker compose up -d`. **Unit mocks only**: no infra; real wiring checked manually. **Unit + e2e with overridden indicators**: no infra, no real connections exercised. | Unit tests with mocked indicators + e2e against docker-compose Postgres and Redis | Decided |
| D13 | Background reconnect for the initial Postgres connection | **Forever, fixed 5 s**: simple and predictable; up to 5 s recovery lag. **Forever, backoff to 30 s**: gentler during long outages; up to 30 s lag. **Configurable via env**: tunable; one more variable. | Retry forever at a fixed 5 s interval | Decided |
| D14 | Defaults for connection variables | **Defaults for host/port** (`localhost`, `5432`, `6379`): short `.env`; a forgotten variable silently points at localhost. **All required**: fails fast; more to set locally. | Defaults for `POSTGRES_HOST`, `POSTGRES_PORT`, `REDIS_HOST`, `REDIS_PORT`. `POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB` stay required | Decided |

### Product questions

None. The readiness route is operational and has no patient-facing behavior.

## What will be implemented

**Dependencies (D2–D5, D7)**
- Runtime: `@nestjs/config`, `zod`, `@nestjs/typeorm`, `typeorm`, `pg`, `ioredis` and `@nestjs/terminus`. Pick versions compatible with NestJS 11 at install time.

**Configuration (`src/config/`, D5, D7, D14)**
- `ConfigModule.forRoot({ isGlobal: true, validate })` in `AppModule`. `validate` parses `process.env` with a Zod schema and throws a readable error at boot when parsing fails.
- Schema:
  - `POSTGRES_HOST` (string, default `localhost`)
  - `POSTGRES_PORT` (port number coerced from string, default `5432`)
  - `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` (non-empty strings, required)
  - `REDIS_HOST` (string, default `localhost`)
  - `REDIS_PORT` (port number, default `6379`)
- The schema's inferred type is used when reading config, so there is no `any` (ESLint `no-explicit-any` is an error).
- `.env.example` gains `POSTGRES_HOST`, `POSTGRES_PORT`, `REDIS_HOST` and `REDIS_PORT` with the local defaults, documented as optional.

**Postgres connection (`src/database/`, D3, D6, D8, D13)**
- A `DatabaseModule` registers `TypeOrmModule.forRootAsync`, using the `pg` driver and building its options from `ConfigService`. It sets `synchronize: false` and has no entities.
- The boot must not fail when Postgres is down (D8). TypeORM's initial connect runs outside Nest's blocking bootstrap retry, and a failed attempt is retried every 5 s with no attempt limit (D13). Each failure is logged at warn level without credentials. After the first successful connect, the `pg` pool handles reconnection for each query.
- While the DataSource isn't initialized, the Postgres check reports `down`.

**Redis client (`src/redis/`, D4, D8, D11)**
- A global `RedisModule` provides one ioredis client under an exported injection token, configured from `ConfigService`.
- It keeps ioredis's automatic reconnection, so boot doesn't fail when Redis is down (D8). Connection errors are logged without flooding: at most once per state change (up→down, down→up).
- The client is closed with `quit()` on application shutdown.

**Readiness route (`src/health/`, D1, D2, D9, D10)**
- `HealthModule` imports `TerminusModule`. `GET /health` is unchanged (D1).
- `GET /health/ready` runs two checks through terminus `HealthCheckService`, each with a 1 s timeout (D10):
  - `postgres`: terminus `TypeOrmHealthIndicator.pingCheck` (`SELECT 1`, reads no table).
  - `redis`: a custom indicator in `src/health/` that sends `PING` through the shared client and expects `PONG`.
- Status: 200 when both are up, 503 when either is down or times out (terminus behavior).
- Body (D9), identical shape for 200 and 503:
  `{ "status": "ok" | "error", "details": { "postgres": "up" | "down", "redis": "up" | "down" } }`.
  Terminus's `info`/`error` sections and the error messages are not returned. When a check fails, the api logs the dependency name and the error message, with no credentials.

### Contract impact on desk-health-agent-core

None. The health routes aren't part of the api ↔ core contract. No queue message, tool endpoint or shared table changes.

### Audit, security and privacy

- No state change, so no `audit_event`.
- The readiness body exposes only up/down per dependency (D9). No hostnames, versions or driver errors.
- Credentials stay in `.env`. Logs never include `POSTGRES_PASSWORD` or a full connection config.
- The checks read no tables, so no tenant or health data is touched.

## Execution steps

1. **Add validated configuration.** Depends on: D5, D7, D14.
   - Changes: install `@nestjs/config` and `zod`. Create `src/config/` with the Zod env schema, its inferred type and the `validate` function. Import `ConfigModule.forRoot({ isGlobal: true, validate })` in `src/app.module.ts`. Add the new variables to `.env.example`.
   - Verify: unit spec for the schema (defaults applied, required variables missing → error, non-numeric port → error) with `npm run test`. `npm run start` with `POSTGRES_USER` unset fails with a readable error.
2. **Connect to Postgres with TypeORM.** Depends on: D3, D6, D8, D13.
   - Changes: install `@nestjs/typeorm`, `typeorm` and `pg`. Create `src/database/database.module.ts` (and a small service if the background retry needs one). Import it in `AppModule`.
   - Verify: with `docker compose up -d`, `npm run start:dev` logs a successful connection. With `docker compose stop postgres`, the api still boots and logs a retry warning every ~5 s. After `docker compose start postgres`, it connects without a restart. `npx tsc --noEmit -p tsconfig.json` is clean.
3. **Add the shared Redis client.** Depends on: D4, D8, D11.
   - Changes: install `ioredis`. Create `src/redis/redis.module.ts` (global, exported token, `quit()` on shutdown). Import it in `AppModule`.
   - Verify: unit spec that the module closes the client on shutdown (`npm run test`). With `docker compose stop redis`, the api still boots and logs the disconnect once. After `docker compose start redis`, it reconnects.
4. **Add `GET /health/ready`.** Depends on: D1, D2, D9, D10.
   - Changes: install `@nestjs/terminus`. Add `TerminusModule` to `src/health/health.module.ts`. Add the Redis indicator in `src/health/`. Add the `ready()` handler in `src/health/health.controller.ts`, which maps the terminus result or `ServiceUnavailableException` to the D9 body. Update `src/health/health.controller.spec.ts` to provide mocked indicators.
   - Verify: unit tests (`npm run test`) for both up → 200 body; Postgres down → 503 with `postgres: down`; Redis down → 503 with `redis: down`; a check exceeding 1 s → 503 `down`; the error message is absent from the body; `check()` still returns `undefined`.
5. **e2e against real infrastructure.** Depends on: D12, steps 1–4.
   - Changes: extend `test/app.e2e-spec.ts` with a `GET /health/ready` case. Keep the `GET /health` case. Make sure `app.close()` releases the TypeORM and Redis connections so Jest exits cleanly.
   - Verify: with `docker compose up -d` and `.env` in place, `npm run test:e2e` passes (`/health` → 200 empty, `/health/ready` → 200 with both `up`). Jest exits without "open handles" warnings.
6. **Refresh CLAUDE.md.** Depends on: steps 1–5.
   - Changes: run `/update-claude-md`.
   - Verify: CLAUDE.md lists the new dependencies, the `src/config/`, `src/database/` and `src/redis/` folders, the new env variables with their defaults, and notes that `npm run test:e2e` needs `docker compose up -d`. The status note no longer says the api doesn't connect to Postgres or Redis.

## Testing plan

- **Unit** (`npm run test`, D12):
  - config schema: defaults, required variables, port coercion;
  - `RedisModule` shutdown;
  - Redis indicator: `PONG` → up, error or timeout → down;
  - `HealthController.ready()` with mocked terminus indicators: 200/503 and the D9 body with no error text;
  - existing `check()` spec kept.
- **e2e** (`npm run test:e2e`, D12): boots `AppModule` against the docker-compose Postgres and Redis. Asserts `/health` → 200 empty and `/health/ready` → 200 with both dependencies `up`. Requires `docker compose up -d` and `.env`.
- **Manual:** the stop/start checks in steps 2 and 3 (boot while a dependency is down, recovery without restart, and `/health/ready` flipping 503 → 200).
- **Static:** `npx tsc --noEmit -p tsconfig.json` and `npm run lint`.
- No concurrency or contract tests: no scheduling logic and no contract change.

## Assumptions to confirm

- **Non-fatal TypeORM boot:** by default `@nestjs/typeorm` blocks bootstrap and throws after `retryAttempts`. Meeting D8/D13 is assumed to need TypeORM's `manualInitialization: true` plus a background `DataSource.initialize()` loop. The exact mechanism must be checked against the installed `@nestjs/typeorm` version at implementation time.
- **Terminus with an uninitialized DataSource:** `TypeOrmHealthIndicator.pingCheck` is assumed to report down, not throw an unhandled error, while the DataSource isn't initialized. If it throws, the Postgres check wraps it and reports `down`.
- **ioredis during an outage:** a `PING` sent while disconnected may queue (offline queue) instead of failing. The 1 s timeout (D10) is assumed to bound it. Confirm that the queued command doesn't pile up across repeated probes.
- **Status values in the body:** `ok`/`error` and `up`/`down` follow terminus's vocabulary. Confirm this wording during review.
- **Folder and token names:** `src/config/`, `src/database/`, `src/redis/` and the Redis injection token name follow the module-per-concern convention. Adjust during review if you prefer other names.
- **`.env` loading in e2e:** `ConfigModule` reads `.env` from the process cwd, which is assumed to be the repo root when running `npm run test:e2e`.

## Open items

No open decisions. Follow-ups for later specs:
- **Migrations (D6):** the spec that creates the first table must wire TypeORM migrations and scripts.
- **Validation library precedent (D7):** Zod is now installed for config. The DTO validation choice (Zod vs class-validator) is still to be made for endpoints.
- **Redis auth and BullMQ settings:** unchanged from spec 001 D12. They must be revisited before queues are introduced, and `RedisModule` (D11) will need matching options.
