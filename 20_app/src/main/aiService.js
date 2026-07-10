const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const settingsService = require("./settingsService");
const earlyStartupLogger = require("./earlyStartupLogger");

const THREAD_STATUSES = new Set(["active", "archived"]);
const PROPOSAL_STATUSES = new Set(["pending", "approved", "rejected", "applied", "failed"]);
const RUN_STATUSES = new Set(["running", "completed", "failed", "canceled"]);
const ACTION_TYPES = new Set(["update_task", "create_task", "update_file"]);

let SQL = null;
let initSqlJs = null;
let db = null;
let dbPath = null;

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function getAiDbPath() {
  return path.join(settingsService.getDataDir(), "ai.sqlite");
}

function getSqlJsInitializer() {
  if (initSqlJs) return initSqlJs;

  try {
    initSqlJs = require("sql.js");
    return initSqlJs;
  } catch (err) {
    earlyStartupLogger.logError("Failed to require sql.js for AI database initialization", err, {
      module: "src/main/aiService.js",
      dependency: "sql.js",
      dbPath: dbPath || getAiDbPath(),
    });
    throw err;
  }
}

function assertDbReady() {
  if (!db) {
    throw new Error("AI database is not initialized.");
  }
}

function saveDb() {
  assertDbReady();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
}

function normalizeStatus(value, allowed, fallback) {
  const status = String(value || fallback);
  return allowed.has(status) ? status : fallback;
}

function nullableString(value) {
  if (value === undefined || value === null || value === "") return null;
  return String(value);
}

function stringifyJson(value, fallback = {}) {
  try {
    return JSON.stringify(value === undefined ? fallback : value);
  } catch (_err) {
    return JSON.stringify(fallback);
  }
}

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (_err) {
    return fallback;
  }
}

function normalizeSqlParams(params = []) {
  return params.map((param) => (param === undefined ? null : param));
}

function run(sql, params = []) {
  assertDbReady();
  db.run(sql, normalizeSqlParams(params));
}

function query(sql, params = []) {
  assertDbReady();
  const stmt = db.prepare(sql);
  const rows = [];
  try {
    stmt.bind(normalizeSqlParams(params));
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
  } finally {
    stmt.free();
  }
  return rows.map(normalizeRow);
}

function getOne(sql, params = []) {
  return query(sql, params)[0] || null;
}

function normalizeRow(row) {
  const output = { ...row };
  if (Object.prototype.hasOwnProperty.call(output, "payload_json")) {
    output.payload = parseJson(output.payload_json, {});
  }
  if (Object.prototype.hasOwnProperty.call(output, "preview_json")) {
    output.preview = parseJson(output.preview_json, null);
  }
  return output;
}

function migrate() {
  run(`
    CREATE TABLE IF NOT EXISTS ai_threads (
      thread_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      codex_thread_id TEXT,
      primary_task_id TEXT,
      change_id TEXT,
      thread_status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_message_at TEXT
    );
  `);
  run(`
    CREATE TABLE IF NOT EXISTS ai_thread_references (
      reference_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      ref_type TEXT NOT NULL,
      ref_id TEXT,
      file_path TEXT,
      label TEXT NOT NULL,
      added_at TEXT NOT NULL,
      FOREIGN KEY(thread_id) REFERENCES ai_threads(thread_id) ON DELETE CASCADE
    );
  `);
  run(`
    CREATE TABLE IF NOT EXISTS ai_messages (
      message_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      codex_run_id TEXT,
      token_count INTEGER,
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(thread_id) REFERENCES ai_threads(thread_id) ON DELETE CASCADE
    );
  `);
  run(`
    CREATE TABLE IF NOT EXISTS ai_action_proposals (
      proposal_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      payload_json TEXT NOT NULL,
      preview_json TEXT,
      proposal_status TEXT NOT NULL DEFAULT 'pending',
      decided_at TEXT,
      applied_at TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(thread_id) REFERENCES ai_threads(thread_id) ON DELETE CASCADE,
      FOREIGN KEY(message_id) REFERENCES ai_messages(message_id) ON DELETE CASCADE
    );
  `);
  run(`
    CREATE TABLE IF NOT EXISTS ai_runs (
      run_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      codex_thread_id TEXT,
      run_status TEXT NOT NULL,
      sandbox TEXT NOT NULL,
      workdir TEXT NOT NULL,
      model TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      error_code TEXT,
      error_message TEXT,
      FOREIGN KEY(thread_id) REFERENCES ai_threads(thread_id) ON DELETE CASCADE
    );
  `);
  run("CREATE INDEX IF NOT EXISTS idx_ai_threads_updated_at ON ai_threads(updated_at);");
  run("CREATE INDEX IF NOT EXISTS idx_ai_messages_thread_created ON ai_messages(thread_id, created_at);");
  run("CREATE INDEX IF NOT EXISTS idx_ai_references_thread ON ai_thread_references(thread_id);");
  run("CREATE INDEX IF NOT EXISTS idx_ai_proposals_thread ON ai_action_proposals(thread_id);");
  run("CREATE INDEX IF NOT EXISTS idx_ai_runs_thread ON ai_runs(thread_id);");
}

async function openAiService() {
  if (db) return { ok: true, path: dbPath };
  settingsService.migrateLegacyResourceData();
  dbPath = getAiDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  try {
    SQL = SQL || await getSqlJsInitializer()({
      locateFile: (file) => require.resolve(`sql.js/dist/${file}`),
    });
  } catch (err) {
    earlyStartupLogger.logError("Failed to initialize sql.js for AI database", err, {
      module: "src/main/aiService.js",
      dbPath,
    });
    throw err;
  }
  db = fs.existsSync(dbPath)
    ? new SQL.Database(fs.readFileSync(dbPath))
    : new SQL.Database();
  run("PRAGMA foreign_keys = ON;");
  migrate();
  saveDb();
  return { ok: true, path: dbPath };
}

function listThreads(options = {}) {
  const includeArchived = Boolean(options.includeArchived);
  return query(
    `SELECT * FROM ai_threads
     WHERE (? = 1 OR thread_status != 'archived')
     ORDER BY COALESCE(last_message_at, updated_at, created_at) DESC`,
    [includeArchived ? 1 : 0],
  );
}

function getThread(threadId) {
  return getOne("SELECT * FROM ai_threads WHERE thread_id = ?", [threadId]);
}

function createThread(input = {}) {
  const timestamp = nowIso();
  const thread = {
    thread_id: nullableString(input.thread_id) || createId("thread"),
    title: String(input.title || "New AI thread").trim() || "New AI thread",
    codex_thread_id: nullableString(input.codex_thread_id),
    primary_task_id: nullableString(input.primary_task_id),
    change_id: nullableString(input.change_id),
    thread_status: normalizeStatus(input.thread_status, THREAD_STATUSES, "active"),
    created_at: timestamp,
    updated_at: timestamp,
    last_message_at: null,
  };
  run(
    `INSERT INTO ai_threads
      (thread_id, title, codex_thread_id, primary_task_id, change_id, thread_status, created_at, updated_at, last_message_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      thread.thread_id,
      thread.title,
      thread.codex_thread_id,
      thread.primary_task_id,
      thread.change_id,
      thread.thread_status,
      thread.created_at,
      thread.updated_at,
      thread.last_message_at,
    ],
  );
  saveDb();
  return getThread(thread.thread_id);
}

function updateThread(threadId, updates = {}) {
  const current = getThread(threadId);
  if (!current) throw new Error(`AI thread not found: ${threadId}`);
  const next = {
    title: updates.title === undefined ? current.title : String(updates.title || current.title),
    codex_thread_id: updates.codex_thread_id === undefined ? current.codex_thread_id : nullableString(updates.codex_thread_id),
    primary_task_id: updates.primary_task_id === undefined ? current.primary_task_id : nullableString(updates.primary_task_id),
    change_id: updates.change_id === undefined ? current.change_id : nullableString(updates.change_id),
    thread_status: updates.thread_status === undefined
      ? current.thread_status
      : normalizeStatus(updates.thread_status, THREAD_STATUSES, current.thread_status),
    updated_at: nowIso(),
  };
  run(
    `UPDATE ai_threads
     SET title = ?, codex_thread_id = ?, primary_task_id = ?, change_id = ?, thread_status = ?, updated_at = ?
     WHERE thread_id = ?`,
    [next.title, next.codex_thread_id, next.primary_task_id, next.change_id, next.thread_status, next.updated_at, threadId],
  );
  saveDb();
  return getThread(threadId);
}

function archiveThread(threadId) {
  return updateThread(threadId, { thread_status: "archived" });
}

function listMessages(threadId) {
  return query(
    "SELECT * FROM ai_messages WHERE thread_id = ? ORDER BY created_at ASC",
    [threadId],
  );
}

function addMessage(input = {}) {
  if (!getThread(input.thread_id)) throw new Error(`AI thread not found: ${input.thread_id}`);
  const timestamp = nowIso();
  const message = {
    message_id: nullableString(input.message_id) || createId("msg"),
    thread_id: String(input.thread_id),
    role: String(input.role || "user"),
    content: String(input.content || ""),
    codex_run_id: nullableString(input.codex_run_id),
    token_count: Number.isFinite(Number(input.token_count)) ? Math.round(Number(input.token_count)) : null,
    error_code: nullableString(input.error_code),
    error_message: nullableString(input.error_message),
    created_at: timestamp,
  };
  run(
    `INSERT INTO ai_messages
      (message_id, thread_id, role, content, codex_run_id, token_count, error_code, error_message, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      message.message_id,
      message.thread_id,
      message.role,
      message.content,
      message.codex_run_id,
      message.token_count,
      message.error_code,
      message.error_message,
      message.created_at,
    ],
  );
  run("UPDATE ai_threads SET updated_at = ?, last_message_at = ? WHERE thread_id = ?", [timestamp, timestamp, message.thread_id]);
  saveDb();
  return getOne("SELECT * FROM ai_messages WHERE message_id = ?", [message.message_id]);
}

function listReferences(threadId) {
  return query(
    "SELECT * FROM ai_thread_references WHERE thread_id = ? ORDER BY added_at ASC",
    [threadId],
  );
}

function addReference(input = {}) {
  if (!getThread(input.thread_id)) throw new Error(`AI thread not found: ${input.thread_id}`);
  const timestamp = nowIso();
  const reference = {
    reference_id: nullableString(input.reference_id) || createId("ref"),
    thread_id: String(input.thread_id),
    ref_type: String(input.ref_type || "file"),
    ref_id: nullableString(input.ref_id),
    file_path: nullableString(input.file_path),
    label: String(input.label || input.ref_id || input.file_path || "Reference"),
    added_at: timestamp,
  };
  run(
    `INSERT INTO ai_thread_references
      (reference_id, thread_id, ref_type, ref_id, file_path, label, added_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [reference.reference_id, reference.thread_id, reference.ref_type, reference.ref_id, reference.file_path, reference.label, reference.added_at],
  );
  run("UPDATE ai_threads SET updated_at = ? WHERE thread_id = ?", [timestamp, reference.thread_id]);
  saveDb();
  return getOne("SELECT * FROM ai_thread_references WHERE reference_id = ?", [reference.reference_id]);
}

function removeReference(referenceId) {
  const current = getOne("SELECT * FROM ai_thread_references WHERE reference_id = ?", [referenceId]);
  if (!current) return { ok: true, removed: false };
  run("DELETE FROM ai_thread_references WHERE reference_id = ?", [referenceId]);
  run("UPDATE ai_threads SET updated_at = ? WHERE thread_id = ?", [nowIso(), current.thread_id]);
  saveDb();
  return { ok: true, removed: true };
}

function createProposal(input = {}) {
  if (!getThread(input.thread_id)) throw new Error(`AI thread not found: ${input.thread_id}`);
  const timestamp = nowIso();
  const proposal = {
    proposal_id: nullableString(input.proposal_id) || createId("proposal"),
    thread_id: String(input.thread_id),
    message_id: String(input.message_id || ""),
    action_type: ACTION_TYPES.has(String(input.action_type)) ? String(input.action_type) : "update_task",
    target_type: String(input.target_type || "task"),
    target_id: nullableString(input.target_id),
    payload_json: stringifyJson(input.payload, {}),
    preview_json: input.preview === undefined ? null : stringifyJson(input.preview, null),
    proposal_status: normalizeStatus(input.proposal_status, PROPOSAL_STATUSES, "pending"),
    created_at: timestamp,
  };
  run(
    `INSERT INTO ai_action_proposals
      (proposal_id, thread_id, message_id, action_type, target_type, target_id, payload_json, preview_json, proposal_status, decided_at, applied_at, error_message, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)`,
    [
      proposal.proposal_id,
      proposal.thread_id,
      proposal.message_id,
      proposal.action_type,
      proposal.target_type,
      proposal.target_id,
      proposal.payload_json,
      proposal.preview_json,
      proposal.proposal_status,
      proposal.created_at,
    ],
  );
  saveDb();
  return getOne("SELECT * FROM ai_action_proposals WHERE proposal_id = ?", [proposal.proposal_id]);
}

function getProposal(proposalId) {
  return getOne("SELECT * FROM ai_action_proposals WHERE proposal_id = ?", [proposalId]);
}

function listProposals(threadId) {
  return query(
    "SELECT * FROM ai_action_proposals WHERE thread_id = ? ORDER BY created_at DESC",
    [threadId],
  );
}

function updateProposal(proposalId, updates = {}) {
  const current = getOne("SELECT * FROM ai_action_proposals WHERE proposal_id = ?", [proposalId]);
  if (!current) throw new Error(`AI proposal not found: ${proposalId}`);
  const status = updates.proposal_status === undefined
    ? current.proposal_status
    : normalizeStatus(updates.proposal_status, PROPOSAL_STATUSES, current.proposal_status);
  const decidedAt = ["approved", "rejected"].includes(status) && !current.decided_at ? nowIso() : current.decided_at;
  const appliedAt = status === "applied" && !current.applied_at ? nowIso() : current.applied_at;
  run(
    `UPDATE ai_action_proposals
     SET proposal_status = ?, decided_at = ?, applied_at = ?, error_message = ?
     WHERE proposal_id = ?`,
    [status, decidedAt, appliedAt, nullableString(updates.error_message) || current.error_message, proposalId],
  );
  saveDb();
  return getOne("SELECT * FROM ai_action_proposals WHERE proposal_id = ?", [proposalId]);
}

function createRun(input = {}) {
  if (!getThread(input.thread_id)) throw new Error(`AI thread not found: ${input.thread_id}`);
  const settings = settingsService.getSettings().settings.aiChat || {};
  const runId = nullableString(input.run_id) || createId("run");
  run(
    `INSERT INTO ai_runs
      (run_id, thread_id, codex_thread_id, run_status, sandbox, workdir, model, started_at, finished_at, error_code, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
    [
      runId,
      String(input.thread_id),
      nullableString(input.codex_thread_id),
      normalizeStatus(input.run_status, RUN_STATUSES, "running"),
      String(input.sandbox || "read-only"),
      String(input.workdir || settings.workdir || ""),
      nullableString(input.model),
      nowIso(),
    ],
  );
  saveDb();
  return getOne("SELECT * FROM ai_runs WHERE run_id = ?", [runId]);
}

function updateRun(runId, updates = {}) {
  const current = getOne("SELECT * FROM ai_runs WHERE run_id = ?", [runId]);
  if (!current) throw new Error(`AI run not found: ${runId}`);
  const status = updates.run_status === undefined
    ? current.run_status
    : normalizeStatus(updates.run_status, RUN_STATUSES, current.run_status);
  const isTerminal = ["completed", "failed", "canceled"].includes(status);
  run(
    `UPDATE ai_runs
     SET codex_thread_id = ?, run_status = ?, finished_at = ?, error_code = ?, error_message = ?
     WHERE run_id = ?`,
    [
      updates.codex_thread_id === undefined ? current.codex_thread_id : nullableString(updates.codex_thread_id),
      status,
      isTerminal ? (current.finished_at || nowIso()) : current.finished_at,
      updates.error_code === undefined ? current.error_code : nullableString(updates.error_code),
      updates.error_message === undefined ? current.error_message : nullableString(updates.error_message),
      runId,
    ],
  );
  saveDb();
  return getOne("SELECT * FROM ai_runs WHERE run_id = ?", [runId]);
}

function listRuns(threadId) {
  return query("SELECT * FROM ai_runs WHERE thread_id = ? ORDER BY started_at DESC", [threadId]);
}

function purgeOldData(days) {
  const retentionDays = Number.isFinite(Number(days))
    ? Math.max(1, Math.round(Number(days)))
    : settingsService.getSettings().settings.aiChat.retentionDays;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const archivedThreads = query(
    "SELECT thread_id FROM ai_threads WHERE thread_status = 'archived' AND updated_at < ?",
    [cutoff],
  );
  archivedThreads.forEach((thread) => {
    run("DELETE FROM ai_threads WHERE thread_id = ?", [thread.thread_id]);
  });
  saveDb();
  return { ok: true, deletedThreads: archivedThreads.length, cutoff };
}

function getDbInfo() {
  assertDbReady();
  return {
    ok: true,
    path: dbPath,
    threadCount: getOne("SELECT COUNT(*) AS count FROM ai_threads").count,
    messageCount: getOne("SELECT COUNT(*) AS count FROM ai_messages").count,
  };
}

module.exports = {
  openAiService,
  getAiDbPath,
  getDbInfo,
  listThreads,
  getThread,
  createThread,
  updateThread,
  archiveThread,
  listMessages,
  addMessage,
  listReferences,
  addReference,
  removeReference,
  createProposal,
  getProposal,
  listProposals,
  updateProposal,
  createRun,
  updateRun,
  listRuns,
  purgeOldData,
};
