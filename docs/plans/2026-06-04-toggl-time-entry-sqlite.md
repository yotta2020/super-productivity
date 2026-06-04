# Toggl-Compatible Time Entries and SQLite Personal Sync

Date: 2026-06-04
Status: proposal for the personal fork branch `codex/toggl-time-entry-db`

## Context

This fork targets a personal Super Productivity setup where time tracking data needs to be more durable and easier to query than the current aggregate task fields.

Super Productivity already has a local-first operation log. Browser/desktop data is persisted in IndexedDB, and SuperSync stores operations plus snapshots server-side. The weak point for this fork is not "the app only uses JSON"; it is that:

- task time is mostly aggregated as `timeSpent` and `timeSpentOnDay`, not itemized as first-class time entries;
- file-based sync providers use a single sync file containing snapshot and recent operations;
- the existing SuperSync server is PostgreSQL-backed, which is heavier than needed for one personal low-resource server.

The direction for this fork is:

1. Add a first-class, itemized time-entry model that can round-trip to a Toggl-like shape.
2. Keep local-first IndexedDB on the client.
3. Add a lightweight SQLite-backed SuperSync deployment path for personal use.
4. Avoid enterprise Toggl fields unless they are needed for compatibility or future import/export.

Reference docs:

- Super Productivity data model: `docs/wiki/4.23-Managing-Your-Data.md`
- Super Productivity dev server: `docs/wiki/2.11-Run-the-Development-Server.md`
- Toggl tracking overview: https://engineering.toggl.com/docs/track/tracking/
- Toggl time entries API: https://engineering.toggl.com/docs/track/api/time_entries/

## Current Shape

### Client time data

`src/app/features/tasks/task.model.ts` currently stores:

- `timeSpent`: aggregate milliseconds on the task.
- `timeSpentOnDay`: date-to-duration map, also in milliseconds.
- `tagIds`, `projectId`, `title`, `created`, `doneOn`, and issue metadata.

`src/app/features/time-tracking/time-tracking.model.ts` stores project/tag work context data as compact maps:

- `s`: start time.
- `e`: end time.
- `b`: break count.
- `bt`: break time.

This is useful for UI totals, but it is not enough to answer "what exactly was the time entry I recorded from 09:12 to 10:03?" or to import/export cleanly to Toggl.

### Server sync data

`packages/super-sync-server/prisma/schema.prisma` currently uses:

- `datasource db { provider = "postgresql" }`
- `Operation.payload Json`
- `Operation.vectorClock Json`
- `UserSyncState.snapshotData Bytes`

This is a good production server layout, but PostgreSQL is more than a personal low-resource server needs.

Important implementation constraint: Prisma datasource providers are schema-level, not runtime-level. A personal SQLite build cannot be implemented by only changing `DATABASE_URL`; it needs a SQLite schema/generation path or a small separate server package that shares the same service code.

## Toggl-Aligned Time Entry Model

Keep names close to Toggl for import/export, while preserving Super Productivity IDs and millisecond precision internally.

```ts
export interface PersonalTimeEntry {
  id: string;

  // Toggl-compatible core
  description: string | null;
  start: string; // RFC3339 UTC
  stop: string | null; // null while running
  duration: number; // seconds; negative for running entries, Toggl-compatible
  tags: string[];
  tagIds: string[];
  projectId: string | null;
  taskId: string | null;
  workspaceId?: string | null;
  createdWith: string;
  at: string; // last update timestamp, RFC3339 UTC

  // Super Productivity local identity
  spTaskId?: string | null;
  spProjectId?: string | null;
  source: 'super-productivity' | 'toggl-import' | 'manual';
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;

  // Internal convenience; derive from start/stop/duration when importing.
  durationMs: number;
}
```

### Keep for personal use

- `description`
- `start`
- `stop`
- `duration`
- `tags`
- `tagIds`
- `projectId`
- `taskId`
- `workspaceId` as optional, because Toggl requires it but a personal local app can treat it as a configured default.
- `createdWith`
- `at`

### Exclude by default

These Toggl response fields are enterprise/team/reporting metadata and should not be stored in the personal model unless a future importer needs them:

- `billable`, `project_billable`
- `client_id`, `client_name`
- `expense_ids`
- `permissions`
- `shared_with`
- `user_avatar_url`, `user_name`
- legacy aliases `wid`, `pid`, `tid`, `uid`
- integration metadata unless a concrete integration needs it

If billable time becomes useful later, add `billable?: boolean` with default `false`, but do not make it part of the first migration.

## Client Storage Plan

### Phase 1: Add itemized time entries without changing UI behavior

Add a new entity store, for example:

- `src/app/features/time-entry/time-entry.model.ts`
- `src/app/features/time-entry/store/time-entry.actions.ts`
- `src/app/features/time-entry/store/time-entry.reducer.ts`
- `src/app/features/time-entry/store/time-entry.selectors.ts`

New actions:

- `startTimeEntry({ taskId, projectId, description, tagIds, start })`
- `stopTimeEntry({ id, stop })`
- `upsertTimeEntry({ entry })`
- `deleteTimeEntry({ id })`
- `importTimeEntries({ entries, source })`

Reducers must maintain the itemized entries. Existing `timeSpent` and `timeSpentOnDay` should remain derived or updated through the same existing code path so current views keep working.

### Phase 2: Wire tracking lifecycle to entries

Current tracking code calls `TaskService.addTimeSpent(...)` and dispatches `syncTimeSpent(...)`. The new behavior should:

1. create a running `PersonalTimeEntry` when tracking starts;
2. update `duration`/`durationMs` as accumulated time is flushed;
3. set `stop` and final `duration` when tracking stops;
4. keep `timeSpent` and `timeSpentOnDay` as compatibility aggregates.

This avoids breaking all existing worklog, metric, archive, and focus-mode code in one step.

### Phase 3: Toggl import/export

Add pure mappers first, then UI/API integration:

- `togglTimeEntryToPersonalTimeEntry(...)`
- `personalTimeEntryToTogglPayload(...)`
- `personalTimeEntryToTogglResponseLike(...)`

Use seconds for Toggl `duration`; keep `durationMs` internally. Running entries use negative duration, matching Toggl.

## SQLite Personal SuperSync

SQLite is the right database type for this fork:

- single-file database;
- no separate database daemon;
- low memory footprint;
- transactional writes;
- easy backup through file copy when WAL is checkpointed;
- enough for one user and a small number of devices.

### Recommended implementation

Add a separate Prisma schema:

- `packages/super-sync-server/prisma/schema.sqlite.prisma`
- generated client under a separate output path, for example `generated/sqlite-client`

The model should mirror the existing server tables. Keep `Operation.payload` and `Operation.vectorClock` as Prisma `Json` if the pinned Prisma version supports SQLite JSON for the generated client; otherwise store them as `String` and serialize explicitly at the repository boundary.

Add scripts:

```json
{
  "prisma:generate:sqlite": "prisma generate --schema prisma/schema.sqlite.prisma",
  "prisma:migrate:sqlite": "prisma migrate deploy --schema prisma/schema.sqlite.prisma",
  "dev:sqlite": "DATABASE_URL=file:./data/supersync.sqlite npm run dev"
}
```

Use a small DB adapter boundary instead of importing `prisma` directly everywhere:

- current: `import { prisma } from './db'`
- target: `import { db } from './db'`

Then `db` can be backed by PostgreSQL or SQLite generated Prisma clients.

### SQLite runtime defaults

Set these on startup for the SQLite path:

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

Use a single-process deployment. SQLite is excellent for a personal server, but it is not the right backend for a horizontally scaled SuperSync cluster.

### Docker target

Add a personal compose file:

- `docker-compose.sqlite.yaml`

Expected service shape:

```yaml
services:
  supersync-sqlite:
    build:
      context: .
      dockerfile: packages/super-sync-server/Dockerfile.sqlite
    environment:
      NODE_ENV: production
      PORT: 1900
      DATABASE_URL: file:/data/supersync.sqlite
      DATA_DIR: /data
    volumes:
      - supersync_sqlite_data:/data
    ports:
      - "1900:1900"

volumes:
  supersync_sqlite_data:
```

PostgreSQL compose remains the upstream-compatible path. SQLite compose is for this personal fork.

## Migration Strategy

### From aggregate task time to itemized entries

Existing data only has daily totals, not exact start/stop intervals. Migration cannot reconstruct true sessions. Use a synthetic migration:

- for each task and each `timeSpentOnDay[date] > 0`;
- create one synthetic `PersonalTimeEntry`;
- `start` = local noon for that date converted to UTC, or `00:00:00Z` if no timezone helper is available;
- `stop` = `start + duration`;
- `description` = task title;
- `source` = `super-productivity`;
- `createdWith` = `super-productivity-migration`;
- add a marker like `isSynthetic?: true` only if the UI needs to distinguish them.

Do not delete `timeSpentOnDay` during the first release. Keep aggregates until itemized entries have proven stable.

### From PostgreSQL SuperSync to SQLite SuperSync

For personal use, prefer a fresh SQLite SuperSync server plus client force-upload/import:

1. export or snapshot current client state;
2. start SQLite SuperSync with empty DB;
3. configure client to the SQLite server;
4. force upload local state;
5. verify snapshot and operation count.

Direct PostgreSQL-to-SQLite migration can be added later, but it is unnecessary for a one-person setup if client state is authoritative.

## Verification

### Unit

- mappers preserve Toggl core fields.
- running entry duration is negative in Toggl shape and non-negative `durationMs` internally.
- aggregate compatibility selectors match old `timeSpentOnDay` totals.
- migration from `timeSpentOnDay` produces deterministic synthetic entries.

### Client integration

- start tracking task -> one running entry exists.
- pause/stop tracking -> entry `stop` is set and `duration` is positive.
- resume tracking -> creates a new entry, not a mutation of the stopped one.
- daily worklog totals match the sum of itemized entries.
- archive flow preserves entries or synthetic aggregate compatibility.

### Server

- PostgreSQL SuperSync tests still pass.
- SQLite SuperSync starts with an empty file DB.
- upload ops, download ops, snapshot upload, snapshot download, and account deletion work against SQLite.
- WAL mode is active.

### Manual smoke on `169-yjy-vpn`

Current dev workspace:

- path: `/home/nfs/d2022-yjy/homedata/github/super-productivity`
- branch: `codex/toggl-time-entry-db`
- frontend dev server: tmux session `sp-dev`
- local access command: `ssh -L 4200:127.0.0.1:4200 169-yjy-vpn`
- browser URL after tunnel: `http://127.0.0.1:4200/`

## Out of Scope

- enterprise Toggl reporting fields;
- team sharing and permissions;
- paid/billable workflow;
- full replacement of local IndexedDB;
- multi-user SQLite server;
- PostgreSQL removal from upstream-compatible SuperSync.

## Risks

- Exact historical intervals cannot be recovered from aggregate `timeSpentOnDay`.
- Many existing UI surfaces assume task-level aggregate time; removing aggregates too early would break worklog and metrics.
- Prisma SQLite support must be checked against the pinned Prisma version before relying on `Json` fields.
- SQLite deployment must stay single-process to avoid write contention surprises.
- Sync conflict behavior must remain operation-log-first; time entries are a new entity type, not a separate sync protocol.
