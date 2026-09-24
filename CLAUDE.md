# CLAUDE.md — desk-health-agent-api

NestJS service of **Front Desk**, the AI scheduling receptionist on WhatsApp for hospitals, clinics and independent practitioners. This repository owns everything except the LLM agent: the WhatsApp webhook (signature check, `wamid` dedup, persist, enqueue), queueing with per-conversation ordering and debounce, the **scheduling core** (source of truth for holds, bookings, cancels, swaps and early-slot offers, protected by a Postgres exclusion constraint), the typed tool endpoints the Python agent calls (`search_slots`, `hold_slot`, `confirm_booking`, `list_appointments`, `cancel`, `reschedule`), outbound sending (24-hour window, templates, rate limits), calendar/HIS adapters, safety configuration storage, KB admin and the audit trail.

The LLM agent lives in the sibling repository `../desk-health-agent-core` (Python, LangGraph). The api validates every tool call: the model proposes, the api decides.

System-wide rules, contracts and the non-negotiable rules: [../CLAUDE.md](../CLAUDE.md). Product spec: [../PRD.md](../PRD.md). Architecture is in §09 and the data model in §10.

> Status: fresh NestJS scaffold. Only the default `AppModule` exists so far; no feature modules yet.

## Tech stack
<!-- auto:stack:start -->
| Role | Technology |
| --- | --- |
| Runtime & language | Node.js 24 (v24.19, `engines` not declared), TypeScript 5.9 (`target` ES2023, `module` nodenext, `strictNullChecks` on, `noImplicitAny` off) |
| Framework | NestJS 11.2 (`@nestjs/common`, `@nestjs/core`), RxJS 7.8, reflect-metadata 0.2 |
| HTTP | Express 5 via `@nestjs/platform-express` 11.2 |
| Testing | Jest 30.5 + ts-jest 29.4, `@nestjs/testing` 11.2, Supertest 7.3 (e2e) |
| Lint & format | ESLint 9.39 (flat config) + typescript-eslint 8.70 (`recommendedTypeChecked`), Prettier 3.9 via `eslint-plugin-prettier` |
| Build/tooling | Nest CLI 11.0 + `@nestjs/schematics` 11.1, ts-node 10.9, npm 11 (`package-lock.json`) |

**Planned (not installed yet):** PostgreSQL + pgvector, Redis + BullMQ, n8n, WhatsApp Cloud API, schema validation (Zod or class-validator), an ORM or migration tool.
<!-- auto:stack:end -->

## Architecture
<!-- auto:structure:start -->
```
desk-health-agent-api/
├── src/
└── test/
```

- `src/`: application source code (Nest `sourceRoot`, compiled to `dist/`). It holds `main.ts`, which bootstraps the app and listens on `PORT`, and `app.module.ts`, the root module that imports every feature module. It also holds the scaffold's `app.controller.ts` and `app.service.ts` (a sample `GET /` returning "Hello World!"). Unit tests sit next to the code they test as `*.spec.ts` (e.g. `app.controller.spec.ts`), and `npm run test` runs them. Feature modules will live in subfolders here, one per module.
- `test/`: end-to-end tests. `app.e2e-spec.ts` boots the full `AppModule` and calls it over HTTP with Supertest. `jest-e2e.json` is the Jest config used by `npm run test:e2e` (matches `*.e2e-spec.ts`).
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
| `npm run test:e2e` | End-to-end tests: `test/**/*.e2e-spec.ts` with `test/jest-e2e.json` |
| `npx jest src/path/to/file.spec.ts` | Run a single unit test file |
| `npx jest -t "name"` | Run tests whose name matches |
| `npx nest g resource <name>` | Scaffold a feature module (module, controller, service, DTOs, spec) |
| `npx nest g module\|controller\|service <name>` | Scaffold a single Nest building block |
| `npx tsc --noEmit -p tsconfig.json` | Type-check without emitting |
<!-- auto:commands:end -->

## Environment variables
<!-- auto:env:start -->
| Variable | Default | Read in |
| --- | --- | --- |
| `PORT` | `3000` | `src/main.ts` |

No `.env.example` yet; add one when the first secret (DB, Redis, WhatsApp) is introduced.
<!-- auto:env:end -->

## Conventions

- **Style:** Prettier with single quotes and trailing commas. ESLint's type-checked rules are on; `no-explicit-any` is off, and `no-floating-promises` and `no-unsafe-argument` are warnings. Run `npm run lint` and `npm run test` before committing.
- **Modules:** one Nest feature module per concern, in its own folder under `src/`. Generate with the Nest CLI so structure and specs stay consistent.
- **Tests:** unit specs sit next to the code as `*.spec.ts`; e2e tests go in `test/` as `*.e2e-spec.ts`. Holds, bookings, swaps and offer acceptance also need concurrency tests against a real Postgres (see the root CLAUDE.md "Testing expectations").
- **Contracts:** queue messages and tool endpoints are shared with `desk-health-agent-core`. Carry `tenant_id`, `conversation_id`, a trace id and `schema_version`, and change both repos together.
- **Language:** code, identifiers, commits and docs in English. Patient-facing text comes from tenant templates or the KB, never hard-coded.

## Maintaining this file

Sections between `<!-- auto:* -->` markers are generated by the `update-claude-md` skill (`/update-claude-md`, defined in [.claude/skills/update-claude-md/SKILL.md](.claude/skills/update-claude-md/SKILL.md)). Edit the text outside the markers by hand, and run the skill after changing dependencies, scripts, folders or env vars.
