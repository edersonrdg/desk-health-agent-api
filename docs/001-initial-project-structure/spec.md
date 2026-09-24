# Spec 001: Initial project structure

- **Status:** Ready
- **Date:** 2026-09-24
- **Repository:** desk-health-agent-api
- **Source description:** "I need an spec to create a initial structure of this project. So in this implementation, i need to configurate a start docker-compose, with a postgres and redis containers with latest version. Remove app.controller.spec and service. Configure the lint and tsconfig to be strict on any types, suport to decorators."
- **PRD references:** §09 Architecture (PostgreSQL, Redis/BullMQ, pgvector), §10 Core data model (`kb_chunk` embeddings)
- **Related specs:** none

## Summary

Sets up the local development foundation for the api. A `docker-compose.yml` runs Postgres and Redis. The NestJS scaffold's sample code is replaced by a minimal `GET /health` endpoint in its own module. TypeScript and ESLint are tightened so implicit and explicit `any` are rejected, and decorator support is kept.

## Scope

**In scope**
- `docker-compose.yml` with Postgres and Redis only, plus `.env.example`.
- Remove `app.controller.ts`, `app.controller.spec.ts` and `app.service.ts`; add a `HealthModule` with `GET /health`.
- Rewrite the e2e test for `GET /health`; add a unit spec for the health controller.
- `tsconfig.json`: full `strict` mode. `eslint.config.mjs`: `no-explicit-any` as error.
- Refresh `CLAUDE.md` with the `update-claude-md` skill.

**Out of scope**
- Connecting the api to Postgres or Redis (no ORM, driver, BullMQ or config module yet).
- A Dockerfile or api container (D4).
- pgvector, Redis tuning for BullMQ, database schema and migrations (see Open items for follow-ups).

## Context

Verified in the repo on 2026-09-24:

- NestJS 11.2 scaffold. `src/app.module.ts` registers `AppController` and `AppService`. `AppController` injects `AppService` and serves `GET /` → `"Hello World!"`.
- `test/app.e2e-spec.ts` asserts `GET /` → 200 `"Hello World!"`. Removing the service and controller breaks it.
- `src/app.controller.spec.ts` is the only unit spec. Without it, `npm run test` fails with "No tests found".
- `tsconfig.json`:
  - Decorators: `experimentalDecorators: true` and `emitDecoratorMetadata: true`.
  - Strictness: `strictNullChecks: true`, `noImplicitAny: false`, `strictBindCallApply: false`, no `strict` flag.
- `eslint.config.mjs` uses `tseslint.configs.recommendedTypeChecked` with these overrides:
  - `@typescript-eslint/no-explicit-any`: `off`
  - `no-floating-promises`: `warn`
  - `no-unsafe-argument`: `warn`
- `src/main.ts` reads `PORT` (default 3000) and calls `bootstrap();` without handling the promise.
- `.gitignore` already ignores `.env` and `.env.*.local`.
- No Docker files, no `.env.example`, no `specs/` before this spec.

## Constraints

- **Decorators stay on.** NestJS dependency injection relies on legacy decorators, so `experimentalDecorators` and `emitDecoratorMetadata` remain enabled. TS 5 standard decorators are not used.
- **No secrets in git** (root CLAUDE.md, LGPD rule 8). Real credentials live only in the git-ignored `.env`. `.env.example` holds dev-only placeholder values.
- **Keep one Postgres.** PRD §09 requires pgvector in the same Postgres as the other data. This spec uses the official `postgres` image (D2), so a later spec must add pgvector before the knowledge base work. It must not introduce a separate vector database.

## Decisions

Every technical choice in this spec comes from this table. All decisions were made by the user.

| ID | Question | Options considered (trade-offs) | Decision (user's choice) | Status |
| --- | --- | --- | --- | --- |
| D1 | What replaces the removed controller/service and the e2e test? | **Remove all**: clean, but no tests left and nothing checks the app boots. **Boot-only e2e**: keeps a DI smoke test, little behavior. **Health endpoint**: useful for probes later, adds new behavior. | Replace with a health endpoint | Decided |
| D2 | Postgres image | **pgvector/pgvector**: matches PRD, third-party image, `pg<major>` tags. **postgres (official)**: most used, has `latest`, no pgvector. | `postgres` (official) | Decided |
| D3 | Meaning of "latest version" for image tags | **Floating `latest`**: zero maintenance, may jump majors, not reproducible. **Pin current major**: patch updates, manual major bumps. **Pin exact**: fully reproducible, no automatic patches. | Floating `latest` tag | Decided |
| D4 | What docker-compose runs | **Infra only**: simple, fast hot reload, host Node needed. **Infra + api container**: one command, needs a Dockerfile, slower mounts on WSL2. | Infra only (Postgres + Redis) | Decided |
| D5 | Health route and response | **GET /health → JSON**: informative, body becomes a contract. **GET /health → empty 200**: nothing to keep stable, less informative. **live + ready**: k8s semantics, readiness has nothing to check yet. | `GET /health` → empty 200 | Decided |
| D6 | Health implementation | **Plain controller**: no dependency, DB checks hand-written later. **@nestjs/terminus**: ready-made indicators, new dependency now. | Plain Nest controller | Decided |
| D7 | Health location | **`src/health/` module**: follows module-per-concern convention. **In AppModule**: fewer files, likely moved later. | `src/health/` module (`HealthModule`) | Decided |
| D8 | Postgres credentials supply | **.env + .env.example**: no secrets in git, one copy step. **Inline**: zero setup, credentials in git. **Inline with defaults**: zero setup, defaults in git. | `.env` (git-ignored) + committed `.env.example` | Decided |
| D9 | Data persistence | **Named volumes**: survives restarts, `latest` major jumps can break the volume. **Ephemeral**: always clean, data lost on recreate. **Bind mounts**: inspectable, WSL2 permission/I/O issues. | Named volumes | Decided |
| D10 | Container healthchecks | **Yes**: real readiness, enables `service_healthy`. **No**: shorter, "running" ≠ "ready". | Yes: `pg_isready` for Postgres, `redis-cli ping` for Redis | Decided |
| D11 | Host ports | **Default 5432/6379**: tool defaults work, may conflict. **Configurable via .env**: flexible, more variables. **Offset**: no conflicts, non-default everywhere. | Default `5432` / `6379` | Decided |
| D12 | Redis configuration | **Image defaults**: simplest, revisit before BullMQ. **noeviction**: BullMQ-safe. **noeviction + AOF**: survives restarts. **Password + noeviction**: prod-like auth. | Image defaults (no custom config) | Decided |
| D13 | tsconfig strictness | **noImplicitAny only**: minimal. **Full `strict: true`**: standard baseline, decorated properties need `!` or constructors. **strict + extras**: strictest, more ceremony. | Full `strict: true` | Decided |
| D14 | ESLint strictness on `any` | **no-explicit-any error**: minimal, library `any` still flows with warnings. **All any-related errors**: `any` can't propagate. **strictTypeChecked**: broadest, clashes with empty `@Module()` classes. | `@typescript-eslint/no-explicit-any`: `error` only | Decided |
| D15 | `no-floating-promises` level | **Error**: prevents silent async failures, main.ts must change. **Warning**: no change now, can slip into commits. | Keep as `warn` | Decided |
| D16 | Keeping `npm run test` green without the scaffold spec | **Health controller spec**: keeps unit setup exercised. **--passWithNoTests**: no filler, hides misconfiguration. **Both**. | Add a health controller unit spec | Decided |

### Product questions

None. This spec is dev tooling only and has no patient-facing behavior.

## What will be implemented

**Local infrastructure (`docker-compose.yml`, D4)**
- Two services, and no api container (D4):
  - `postgres`: official `postgres:latest` image (D2, D3).
  - `redis`: `redis:latest` image (D3), with image defaults and no custom command (D12).
- Postgres credentials come from `.env` through the image's standard variables `POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB` (D8).
- `.env.example` documents those variables with dev-only placeholder values (D8, constraint "No secrets in git"). `.env` stays git-ignored, as it already is.
- Each service stores its data in a named volume (D9).
- Healthchecks: Postgres uses `pg_isready`, Redis uses `redis-cli ping` (D10).
- Published ports: `5432:5432` and `6379:6379` (D11).

**Scaffold replacement (D1, D5–D7, D16)**
- Delete `src/app.controller.ts`, `src/app.controller.spec.ts` and `src/app.service.ts`.
- `src/app.module.ts` imports `HealthModule` and has no controllers or providers of its own (D7).
- `src/health/health.module.ts` and `src/health/health.controller.ts` are a plain Nest controller with no new dependencies (D6). It exposes `GET /health`, which returns 200 with an empty body (D5).
- `src/health/health.controller.spec.ts` is a unit spec for the controller (D16).
- `test/app.e2e-spec.ts` is rewritten to assert `GET /health` → 200 with an empty body, and the old `GET /` assertion is removed (D1, D5).

**TypeScript and lint (D13–D15)**
- `tsconfig.json`: add `"strict": true` (D13).
  - Remove the flags that would override or duplicate it: `noImplicitAny: false`, `strictBindCallApply: false` and `strictNullChecks: true`.
  - Keep `experimentalDecorators` and `emitDecoratorMetadata` (constraint "Decorators stay on"). All other options are unchanged.
- `eslint.config.mjs`: `@typescript-eslint/no-explicit-any` goes from `off` to `error` (D14). `no-floating-promises` and `no-unsafe-argument` stay `warn` (D14, D15). The preset stays `recommendedTypeChecked` (D14).

**Documentation**
- Run `/update-claude-md` so `CLAUDE.md` reflects:
  - the new `src/health/` folder,
  - the Docker files and `.env.example`,
  - the new env variables,
  - the Postgres and Redis entries moving out of "Planned".

### Contract impact on desk-health-agent-core

None. `GET /health` isn't part of the api ↔ core contract (queue messages and tool endpoints). No shared tables are created.

### Audit, security and privacy

- No state changes, so no `audit_event`.
- Credentials stay out of git (D8). `.env.example` contains only obvious dev placeholders.
- `GET /health` exposes no data (D5).
- Postgres and Redis publish on default host ports with no Redis auth (D11, D12). This is acceptable only for local development. The compose file is not a deployment artifact.

## Execution steps

1. **Replace scaffold with HealthModule.** Depends on: D1, D5, D6, D7, D16.
   - Changes: delete `src/app.controller.ts`, `src/app.controller.spec.ts` and `src/app.service.ts`. Create `src/health/health.module.ts`, `src/health/health.controller.ts` and `src/health/health.controller.spec.ts` (the Nest CLI can scaffold them with `npx nest g module health` and `npx nest g controller health`). Update `src/app.module.ts`. Rewrite `test/app.e2e-spec.ts` for `GET /health`.
   - Verify: `npm run test` passes (health unit spec), and `npm run test:e2e` passes (`GET /health` → 200, empty body). `npm run build` succeeds.
2. **Enable strict TypeScript.** Depends on: D13.
   - Changes: `tsconfig.json`, plus any code the new checks flag.
   - Verify: `npx tsc --noEmit -p tsconfig.json` has no errors, and `npm run build`, `npm run test` and `npm run test:e2e` still pass.
3. **Make `no-explicit-any` an error.** Depends on: D14, D15.
   - Changes: `eslint.config.mjs`.
   - Verify: `npm run lint` exits 0 with no errors (existing warnings allowed, D15). Temporarily adding `const x: any = 1;` makes lint fail; remove it afterwards.
4. **Add docker-compose and .env.example.** Depends on: D2, D3, D4, D8, D9, D10, D11, D12.
   - Changes: create `docker-compose.yml` and `.env.example` at the repo root.
   - Verify: `cp .env.example .env && docker compose up -d`, then `docker compose ps` shows both services as `healthy`. Also check:
     - `docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c 'select version();'` answers;
     - `docker compose exec redis redis-cli ping` returns `PONG`;
     - after `docker compose down && docker compose up -d`, the named volumes still exist (`docker volume ls`).
5. **Refresh CLAUDE.md.** Depends on: steps 1–4.
   - Changes: run `/update-claude-md`.
   - Verify: CLAUDE.md shows `src/health/` in the Architecture tree, the Docker commands and the `.env` variables, and lists Postgres and Redis as installed infra.

## Testing plan

- **Unit:** `src/health/health.controller.spec.ts` checks that the handler resolves without a body (D16). Run with `npm run test`.
- **e2e:** `test/app.e2e-spec.ts` boots `AppModule` and asserts `GET /health` → 200, empty body (D1, D5). Run with `npm run test:e2e`.
- **Static:** `npx tsc --noEmit -p tsconfig.json` and `npm run lint` (D13, D14).
- **Infrastructure:** manual checks from step 4 (healthy status, connections, persistence across `down`/`up`).
- No concurrency or contract tests: this spec has no scheduling logic and no contract changes.

## Assumptions to confirm

- **Placeholder values in `.env.example`:** the exact dev values for `POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB` aren't decided. Confirm them during review, or pick obvious non-secret placeholders at implementation.
- **Service and volume names:** the compose service names are assumed to be `postgres` and `redis`. Volume names are assumed to follow them.
- **Postgres data path:** the volume's mount path in the container must follow the current `postgres:latest` image documentation. Recent major versions changed the recommended data directory, so check it at implementation time rather than copying an older example.
- **Strict-mode fallout:** full `strict` mode is assumed to need no changes beyond the files in this spec. The current code is small, and step 2 surfaces anything else.

## Open items

No open decisions. Follow-ups for later specs, as consequences of the decisions above:
- **pgvector (D2):** switch the image or add the extension before any knowledge base work (PRD §09, §10).
- **Redis for BullMQ (D12):** set `maxmemory-policy noeviction` before BullMQ is introduced, and decide on persistence.
- **`latest` + named volumes (D3, D9):** when `postgres:latest` moves to a new major, the existing volume won't start until it's removed (`docker compose down -v`) or migrated.
