#!/usr/bin/env node

import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createHash,
  pbkdf2Sync,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PERSONAL_SERVER_PORT || 4280);
const DATA_DIR =
  process.env.PERSONAL_SERVER_DATA_DIR || path.join(REPO_ROOT, '.personal-data');
const DB_PATH = process.env.PERSONAL_SERVER_DB || path.join(DATA_DIR, 'personal.sqlite');
const SESSION_TTL_MS = Number(
  process.env.PERSONAL_SESSION_TTL_MS || 7 * 24 * 60 * 60 * 1000,
);
const DEFAULT_USER = process.env.PERSONAL_SERVER_USER || 'admin';
const DEFAULT_PASSWORD = process.env.PERSONAL_SERVER_PASSWORD || 'super-productivity';
const ALLOWED_ORIGINS = new Set(
  (
    process.env.PERSONAL_SERVER_CORS_ORIGINS ||
    'http://127.0.0.1:4200,http://localhost:4200'
  )
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean),
);

mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS app_snapshots (
    user_id INTEGER PRIMARY KEY,
    json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_config (
    user_id INTEGER PRIMARY KEY,
    json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS visions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '#2f7dd3',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS time_entries (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    start TEXT NOT NULL,
    stop TEXT,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    tag_ids_json TEXT NOT NULL DEFAULT '[]',
    tags_json TEXT NOT NULL DEFAULT '[]',
    project_id TEXT,
    vision_id TEXT,
    task_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_visions_user_status ON visions(user_id, status);
  CREATE INDEX IF NOT EXISTS idx_time_entries_user_start ON time_entries(user_id, start);
  CREATE INDEX IF NOT EXISTS idx_time_entries_user_project ON time_entries(user_id, project_id);
  CREATE INDEX IF NOT EXISTS idx_time_entries_user_vision ON time_entries(user_id, vision_id);
`);

ensureDefaultUser();

const server = createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  applyCors(res, origin);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    const route = `${req.method || 'GET'} ${url.pathname}`;

    if (route === 'GET /api/personal/status') {
      const user = getUserFromRequest(req);
      sendJson(res, 200, {
        enabled: true,
        authenticated: !!user,
        user: user ? { id: user.id, username: user.username } : null,
      });
      return;
    }

    if (route === 'POST /api/personal/login') {
      const body = await readJson(req);
      const username = String(body.username || '');
      const password = String(body.password || '');
      const user = getUserByUsername(username);

      if (!user || !verifyPassword(password, user.password_salt, user.password_hash)) {
        sendJson(res, 401, { error: 'Invalid username or password' });
        return;
      }

      const token = randomBytes(32).toString('base64url');
      const tokenHash = hashToken(token);
      const expiresAt = Date.now() + SESSION_TTL_MS;
      db.prepare(
        `INSERT INTO sessions (token_hash, user_id, expires_at, created_at)
         VALUES (?, ?, ?, ?)`,
      ).run(tokenHash, user.id, expiresAt, now());

      res.setHeader(
        'Set-Cookie',
        `sp_personal_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(
          SESSION_TTL_MS / 1000,
        )}`,
      );
      sendJson(res, 200, { user: { id: user.id, username: user.username } });
      return;
    }

    if (route === 'POST /api/personal/logout') {
      const token = getSessionToken(req);
      if (token) {
        db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
      }
      res.setHeader(
        'Set-Cookie',
        'sp_personal_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
      );
      sendJson(res, 200, { ok: true });
      return;
    }

    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Authentication required' });
      return;
    }

    if (route === 'GET /api/personal/app-data') {
      const row = db
        .prepare('SELECT json, updated_at FROM app_snapshots WHERE user_id = ?')
        .get(user.id);
      sendJson(res, 200, {
        data: row ? JSON.parse(row.json) : null,
        updatedAt: row?.updated_at || null,
      });
      return;
    }

    if (route === 'PUT /api/personal/app-data') {
      const body = await readJson(req);
      const json = JSON.stringify(body.data ?? null);
      const updatedAt = now();
      db.prepare(
        `INSERT INTO app_snapshots (user_id, json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
      ).run(user.id, json, updatedAt);
      sendJson(res, 200, { ok: true, updatedAt });
      return;
    }

    if (route === 'GET /api/personal/config') {
      const row = db
        .prepare('SELECT json, updated_at FROM user_config WHERE user_id = ?')
        .get(user.id);
      sendJson(res, 200, {
        config: row ? JSON.parse(row.json) : null,
        updatedAt: row?.updated_at || null,
      });
      return;
    }

    if (route === 'PUT /api/personal/config') {
      const body = await readJson(req);
      const json = JSON.stringify(body.config ?? null);
      const updatedAt = now();
      db.prepare(
        `INSERT INTO user_config (user_id, json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
      ).run(user.id, json, updatedAt);
      sendJson(res, 200, { ok: true, updatedAt });
      return;
    }

    if (route === 'GET /api/personal/visions') {
      const rows = db
        .prepare(
          `SELECT id, title, description, color, status, created_at, updated_at, archived_at
           FROM visions
           WHERE user_id = ?
           ORDER BY archived_at IS NOT NULL, updated_at DESC`,
        )
        .all(user.id);
      sendJson(res, 200, { visions: rows.map(mapVisionRow) });
      return;
    }

    if (route === 'POST /api/personal/visions') {
      const body = await readJson(req);
      const created = normalizeVision(body);
      db.prepare(
        `INSERT INTO visions (id, user_id, title, description, color, status, created_at, updated_at, archived_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        created.id,
        user.id,
        created.title,
        created.description,
        created.color,
        created.status,
        created.createdAt,
        created.updatedAt,
        created.archivedAt,
      );
      sendJson(res, 201, { vision: created });
      return;
    }

    const visionMatch = url.pathname.match(/^\/api\/personal\/visions\/([^/]+)$/);
    if (visionMatch && req.method === 'PUT') {
      const body = await readJson(req);
      const id = decodeURIComponent(visionMatch[1]);
      const existing = db
        .prepare('SELECT * FROM visions WHERE id = ? AND user_id = ?')
        .get(id, user.id);
      if (!existing) {
        sendJson(res, 404, { error: 'Vision not found' });
        return;
      }
      const updated = normalizeVision({ ...mapVisionRow(existing), ...body, id });
      updated.createdAt = existing.created_at;
      updated.updatedAt = now();
      db.prepare(
        `UPDATE visions
         SET title = ?, description = ?, color = ?, status = ?, updated_at = ?, archived_at = ?
         WHERE id = ? AND user_id = ?`,
      ).run(
        updated.title,
        updated.description,
        updated.color,
        updated.status,
        updated.updatedAt,
        updated.archivedAt,
        id,
        user.id,
      );
      sendJson(res, 200, { vision: updated });
      return;
    }

    if (visionMatch && req.method === 'DELETE') {
      const id = decodeURIComponent(visionMatch[1]);
      db.prepare('DELETE FROM visions WHERE id = ? AND user_id = ?').run(id, user.id);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (route === 'GET /api/personal/time-entries') {
      const includeDeleted = url.searchParams.get('includeDeleted') === 'true';
      const where = includeDeleted
        ? 'WHERE user_id = ?'
        : 'WHERE user_id = ? AND deleted_at IS NULL';
      const rows = db
        .prepare(
          `SELECT *
           FROM time_entries
           ${where}
           ORDER BY start DESC, updated_at DESC`,
        )
        .all(user.id);
      sendJson(res, 200, { entries: rows.map(mapTimeEntryRow) });
      return;
    }

    if (route === 'POST /api/personal/time-entries') {
      const body = await readJson(req);
      const entry = normalizeTimeEntry(body);
      insertTimeEntry(user.id, entry);
      sendJson(res, 201, { entry });
      return;
    }

    if (route === 'PATCH /api/personal/time-entries/batch') {
      const body = await readJson(req);
      const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
      const changes =
        body.changes && typeof body.changes === 'object' ? body.changes : {};
      const deletedAt = body.delete === true ? now() : undefined;
      const updatedAt = now();

      for (const id of ids) {
        const existing = db
          .prepare('SELECT * FROM time_entries WHERE id = ? AND user_id = ?')
          .get(id, user.id);
        if (!existing) continue;
        const current = mapTimeEntryRow(existing);
        const entry = normalizeTimeEntry({
          ...current,
          ...changes,
          id,
          updatedAt,
          deletedAt: deletedAt ?? current.deletedAt,
        });
        updateTimeEntry(user.id, entry);
      }
      sendJson(res, 200, { ok: true, updatedAt });
      return;
    }

    const timeEntryMatch = url.pathname.match(/^\/api\/personal\/time-entries\/([^/]+)$/);
    if (timeEntryMatch && req.method === 'PUT') {
      const id = decodeURIComponent(timeEntryMatch[1]);
      const existing = db
        .prepare('SELECT * FROM time_entries WHERE id = ? AND user_id = ?')
        .get(id, user.id);
      if (!existing) {
        sendJson(res, 404, { error: 'Time entry not found' });
        return;
      }
      const body = await readJson(req);
      const entry = normalizeTimeEntry({
        ...mapTimeEntryRow(existing),
        ...body,
        id,
        updatedAt: now(),
      });
      updateTimeEntry(user.id, entry);
      sendJson(res, 200, { entry });
      return;
    }

    if (timeEntryMatch && req.method === 'DELETE') {
      const id = decodeURIComponent(timeEntryMatch[1]);
      const deletedAt = now();
      db.prepare(
        `UPDATE time_entries
         SET deleted_at = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`,
      ).run(deletedAt, deletedAt, id, user.id);
      sendJson(res, 200, { ok: true, deletedAt });
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Personal server listening at http://127.0.0.1:${PORT}`);
  console.log(`SQLite database: ${DB_PATH}`);
  if (!process.env.PERSONAL_SERVER_PASSWORD) {
    console.warn(
      'Using default personal password. Set PERSONAL_SERVER_PASSWORD for real use.',
    );
  }
});

function applyCors(res, origin) {
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function now() {
  return new Date().toISOString();
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function passwordHash(password, salt) {
  return pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
}

function verifyPassword(password, salt, expectedHash) {
  const actual = Buffer.from(passwordHash(password, salt), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function ensureDefaultUser() {
  const existing = getUserByUsername(DEFAULT_USER);
  if (existing) return;

  const salt = randomBytes(16).toString('hex');
  db.prepare(
    `INSERT INTO users (username, password_hash, password_salt, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(DEFAULT_USER, passwordHash(DEFAULT_PASSWORD, salt), salt, now());
}

function getUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

function getSessionToken(req) {
  const cookies = String(req.headers.cookie || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
  for (const cookie of cookies) {
    const [name, ...rest] = cookie.split('=');
    if (name === 'sp_personal_session') {
      return decodeURIComponent(rest.join('='));
    }
  }
  return null;
}

function getUserFromRequest(req) {
  const token = getSessionToken(req);
  if (!token) return null;

  const tokenHash = hashToken(token);
  const row = db
    .prepare(
      `SELECT users.id, users.username
       FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
    )
    .get(tokenHash, Date.now());
  if (!row) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }
  return row;
}

function normalizeVision(input) {
  const timestamp = now();
  return {
    id: String(input.id || randomUUID()),
    title: String(input.title || '').trim() || 'Untitled vision',
    description: String(input.description || ''),
    color: String(input.color || '#2f7dd3'),
    status: input.status === 'archived' ? 'archived' : 'active',
    createdAt: String(input.createdAt || timestamp),
    updatedAt: String(input.updatedAt || timestamp),
    archivedAt: input.archivedAt ? String(input.archivedAt) : null,
  };
}

function mapVisionRow(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    color: row.color,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

function normalizeTimeEntry(input) {
  const timestamp = now();
  const start = String(input.start || timestamp);
  const stop = input.stop ? String(input.stop) : null;
  const durationMs =
    typeof input.durationMs === 'number'
      ? Math.max(0, Math.round(input.durationMs))
      : calcDurationMs(start, stop);

  return {
    id: String(input.id || randomUUID()),
    description: String(input.description || ''),
    start,
    stop,
    durationMs,
    tagIds: Array.isArray(input.tagIds) ? input.tagIds.map(String) : [],
    tags: Array.isArray(input.tags) ? input.tags.map(String) : [],
    projectId: input.projectId ? String(input.projectId) : null,
    visionId: input.visionId ? String(input.visionId) : null,
    taskId: input.taskId ? String(input.taskId) : null,
    createdAt: String(input.createdAt || timestamp),
    updatedAt: String(input.updatedAt || timestamp),
    deletedAt: input.deletedAt ? String(input.deletedAt) : null,
  };
}

function calcDurationMs(start, stop) {
  if (!stop) return 0;
  const diff = new Date(stop).getTime() - new Date(start).getTime();
  return Number.isFinite(diff) ? Math.max(0, diff) : 0;
}

function mapTimeEntryRow(row) {
  return {
    id: row.id,
    description: row.description,
    start: row.start,
    stop: row.stop,
    durationMs: row.duration_ms,
    tagIds: JSON.parse(row.tag_ids_json || '[]'),
    tags: JSON.parse(row.tags_json || '[]'),
    projectId: row.project_id,
    visionId: row.vision_id,
    taskId: row.task_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function insertTimeEntry(userId, entry) {
  db.prepare(
    `INSERT INTO time_entries (
       id, user_id, description, start, stop, duration_ms, tag_ids_json, tags_json,
       project_id, vision_id, task_id, created_at, updated_at, deleted_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.id,
    userId,
    entry.description,
    entry.start,
    entry.stop,
    entry.durationMs,
    JSON.stringify(entry.tagIds),
    JSON.stringify(entry.tags),
    entry.projectId,
    entry.visionId,
    entry.taskId,
    entry.createdAt,
    entry.updatedAt,
    entry.deletedAt,
  );
}

function updateTimeEntry(userId, entry) {
  db.prepare(
    `UPDATE time_entries
     SET description = ?, start = ?, stop = ?, duration_ms = ?, tag_ids_json = ?,
         tags_json = ?, project_id = ?, vision_id = ?, task_id = ?, updated_at = ?,
         deleted_at = ?
     WHERE id = ? AND user_id = ?`,
  ).run(
    entry.description,
    entry.start,
    entry.stop,
    entry.durationMs,
    JSON.stringify(entry.tagIds),
    JSON.stringify(entry.tags),
    entry.projectId,
    entry.visionId,
    entry.taskId,
    entry.updatedAt,
    entry.deletedAt,
    entry.id,
    userId,
  );
}
