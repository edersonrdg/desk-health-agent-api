# CLAUDE.md — desk-health-agent-api

NestJS service of **Front Desk**, the AI scheduling receptionist on WhatsApp for hospitals, clinics and independent practitioners. This repository owns everything except the LLM agent: the WhatsApp webhook (signature check, `wamid` dedup, persist, enqueue), queueing with per-conversation ordering and debounce, the **scheduling core** (source of truth for holds, bookings, cancels, swaps and early-slot offers, protected by a Postgres exclusion constraint), the typed tool endpoints the Python agent calls (`search_slots`, `hold_slot`, `confirm_booking`, `list_appointments`, `cancel`, `reschedule`), outbound sending (24-hour window, templates, rate limits), calendar/HIS adapters, safety configuration storage, KB admin and the audit trail.

The LLM agent lives in the sibling repository `../desk-health-agent-core` (Python, LangGraph). The api validates every tool call: the model proposes, the api decides.

System-wide rules, contracts and the non-negotiable rules: [../CLAUDE.md](../CLAUDE.md). Product spec: [../PRD.md](../PRD.md). Architecture is in §09 and the data model in §10.

> Status: spec 002. The api connects to Postgres (TypeORM, no entities or migrations yet) and Redis (ioredis), and exposes `GET /health` (liveness) and `GET /health/ready` (readiness). No domain modules exist yet.

## Tech stack
<!-- auto:stack:start -->
| Role | Technology |
| --- | --- |
| Runtime & language | Node.js 24 (v24.19, `engines` not declared), TypeScript 5.9 (`strict: true`, `target` ES2023, `module` nodenext, legacy decorators via `experimentalDecorators` + `emitDecoratorMetadata`) |
| Framework | NestJS 11.2 (`@nestjs/common`, `@nestjs/core`), RxJS 7.8, reflect-metadata 0.2 |
| HTTP | Express 5 via `@nestjs/platform-express` 11.2 |
| Config | `@nestjs/config` 4.0 (global `ConfigModule`), Zod 4.6 for the env schema |
| Data | PostgreSQL via TypeORM 1.1 + `@nestjs/typeorm` 11.0 and `pg` 8.23 (connection only: no entities, no migrations, `synchronize: false`) |
| Cache/Queue | Redis via ioredis 5.11 (one shared client) |
| Health | `@nestjs/terminus` 11.1 (`GET /health/ready`) |
| Testing | Jest 30.5 + ts-jest 29.4, `@nestjs/testing` 11.2, Supertest 7.3 (e2e) |
| Lint & format | ESLint 9.39 (flat config) + typescript-eslint 8.70 (`recommendedTypeChecked`), Prettier 3.9 via `eslint-plugin-prettier` |
| Build/tooling | Nest CLI 11.0 + `@nestjs/schematics` 11.1, ts-node 10.9, npm 11 (`package-lock.json`) |
| Local infra | Docker Compose (`docker-compose.yml`): PostgreSQL (`postgres:latest`) and Redis (`redis:latest`), with named volumes and healthchecks |

The `@nestjs/*` companion packages are pinned to the NestJS 11 lines (config 4, terminus 11, typeorm 11). Their 12.x releases are ESM-only and can't be loaded by Jest in this CommonJS project.

**Planned (not installed yet):** pgvector, BullMQ, n8n, WhatsApp Cloud API, request DTO validation (Zod or class-validator), TypeORM migrations.
<!-- auto:stack:end -->

## Architecture
<!-- auto:structure:start -->
```
desk-health-agent-api/
├── docs/
│   ├── 001-initial-project-structure/
│   └── 002-readiness-health-check/
├── src/
│   ├── config/
│   ├── modules/
│   │   └── health/
│   └── shared/
│       ├── database/
│       ├── redis/
│       └── utils/
└── test/
```

- `docs/`: one folder per feature, numbered `NNN-<slug>/`. Each holds a `spec.md` written with the `create-spec` skill, which records the user's decisions and the execution steps for that feature.
- `docs/001-initial-project-structure/`: `spec.md` for the initial NestJS structure, `GET /health` liveness and the docker-compose Postgres and Redis.
- `docs/002-readiness-health-check/`: `spec.md` for validated config, the Postgres and Redis connections and `GET /health/ready`.
- `src/`: application source code (Nest `sourceRoot`, compiled to `dist/`). `main.ts` bootstraps the app, enables shutdown hooks and listens on `PORT`. `app.module.ts` is the root module: it loads the global `ConfigModule` (validated by `validateEnv`) and imports `DatabaseModule`, `RedisModule` and `HealthModule`. Code is split into `config/`, `modules/` (one folder per feature module) and `shared/` (infrastructure modules and helpers reused across features).
- `src/config/`: `env.schema.ts` holds the Zod env schema, its inferred `Env` type (use with `ConfigService<Env, true>` and `{ infer: true }`) and `validateEnv`, which fails boot with a readable error that never echoes values. `env.schema.spec.ts` tests defaults, required variables and port coercion.
- `src/shared/database/`: `DatabaseModule` registers the TypeORM Postgres DataSource with `manualInitialization: true`. `DatabaseConnector` (`database-connector.service.ts`) initializes it in the background after boot and retries every 5 s forever, so the api starts even when Postgres is down.
- `src/modules/health/`: `HealthModule` (imports `TerminusModule` with its logger off). `health.controller.ts` serves `GET /health` (liveness: 200, empty body, no checks) and `GET /health/ready` (readiness: Postgres `SELECT 1` and Redis `PING`, 1 s timeout each; 200 or 503 with `{ status, details: { postgres, redis } }` as up/down only, failures logged instead of returned). `redis.health.ts` is the custom Redis indicator. Specs sit next to both.
- `src/shared/redis/`: global `RedisModule` exporting one ioredis client under the `REDIS_CLIENT` token (`redis.constants.ts`). `redis.client.ts` builds the client and logs connection state only on up/down transitions. The module quits (or disconnects) the client on shutdown.
- `src/shared/utils/`: small shared helpers. `error-message.ts` turns an unknown error into a loggable message (falls back to the error code for Node's empty-message `AggregateError`).
- `test/`: end-to-end tests. `app.e2e-spec.ts` boots the full `AppModule` and checks `GET /health` and `GET /health/ready` over HTTP with Supertest, **against the docker-compose Postgres and Redis** (needs `docker compose up -d` and `.env`). `jest-e2e.json` is the Jest config used by `npm run test:e2e` (matches `*.e2e-spec.ts`).
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
| `REDIS_HOST` | `localhost` | `src/config/env.schema.ts` → `RedisModule` |
| `REDIS_PORT` | `6379` | `src/config/env.schema.ts` → `RedisModule` |

Copy `.env.example` (committed, dev-only placeholders) to `.env` (git-ignored). `ConfigModule` loads `.env` from the working directory, and the api refuses to boot if a required variable is missing or a port is invalid. `docker compose` also refuses to start without the three required `POSTGRES_*` variables.
<!-- auto:env:end -->

## Conventions

- **Style:** Prettier with single quotes and trailing commas. TypeScript runs in `strict` mode. ESLint's type-checked rules are on; `no-explicit-any` is an error, while `no-floating-promises` and `no-unsafe-argument` are warnings. Run `npm run lint` and `npm run test` before committing.
- **Modules:** one Nest feature module per concern, in its own folder under `src/modules/`. Code reused across features (infrastructure modules, helpers) goes in `src/shared/`. Generate with the Nest CLI so structure and specs stay consistent.
- **Tests:** unit specs sit next to the code as `*.spec.ts`; e2e tests go in `test/` as `*.e2e-spec.ts`. Holds, bookings, swaps and offer acceptance also need concurrency tests against a real Postgres (see the root CLAUDE.md "Testing expectations").
- **Contracts:** queue messages and tool endpoints are shared with `desk-health-agent-core`. Carry `tenant_id`, `conversation_id`, a trace id and `schema_version`, and change both repos together.
- **Language:** code, identifiers, commits and docs in English. Patient-facing text comes from tenant templates or the KB, never hard-coded.

## Maintaining this file

Sections between `<!-- auto:* -->` markers are generated by the `update-claude-md` skill (`/update-claude-md`, defined in [.claude/skills/update-claude-md/SKILL.md](.claude/skills/update-claude-md/SKILL.md)). Edit the text outside the markers by hand, and run the skill after changing dependencies, scripts, folders or env vars.
