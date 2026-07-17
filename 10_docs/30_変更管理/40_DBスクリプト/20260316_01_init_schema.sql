-- =============================================================
-- Cotaska 初期スキーマ
-- ファイル: 20260316_01_init_schema.sql
-- 作成日:   2026-03-16
-- 対象DB:   SQLite (better-sqlite3)
-- =============================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- =============================================================
-- mst_list: リストマスタ
-- =============================================================
CREATE TABLE IF NOT EXISTS mst_list (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    color       TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_mst_list_sort_order
    ON mst_list (sort_order);

-- =============================================================
-- mst_tag: タグマスタ
-- =============================================================
CREATE TABLE IF NOT EXISTS mst_tag (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    color       TEXT,
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL,
    CONSTRAINT uq_mst_tag_name UNIQUE (name)
);

-- =============================================================
-- trx_task: タスクデータ
-- =============================================================
CREATE TABLE IF NOT EXISTS trx_task (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    title           TEXT    NOT NULL,
    content         TEXT,
    status          TEXT    NOT NULL DEFAULT 'todo',
    priority        TEXT    NOT NULL DEFAULT 'medium',
    progress        INTEGER NOT NULL DEFAULT 0,
    list_id         INTEGER,
    due_date        TEXT,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    delete_flag     INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT    NOT NULL,
    updated_at      TEXT    NOT NULL,
    completed_at    TEXT,
    deleted_at      TEXT,
    CONSTRAINT fk_trx_task_list_id
        FOREIGN KEY (list_id) REFERENCES mst_list (id)
);

CREATE INDEX IF NOT EXISTS ix_trx_task_status
    ON trx_task (status);
CREATE INDEX IF NOT EXISTS ix_trx_task_list_id
    ON trx_task (list_id);
CREATE INDEX IF NOT EXISTS ix_trx_task_due_date
    ON trx_task (due_date);
CREATE INDEX IF NOT EXISTS ix_trx_task_delete_flag
    ON trx_task (delete_flag);

-- =============================================================
-- trx_task_tag: タスクタグデータ
-- =============================================================
CREATE TABLE IF NOT EXISTS trx_task_tag (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id     INTEGER NOT NULL,
    tag_id      INTEGER NOT NULL,
    created_at  TEXT    NOT NULL,
    CONSTRAINT fk_trx_task_tag_task_id
        FOREIGN KEY (task_id) REFERENCES trx_task (id) ON DELETE CASCADE,
    CONSTRAINT fk_trx_task_tag_tag_id
        FOREIGN KEY (tag_id) REFERENCES mst_tag (id) ON DELETE CASCADE,
    CONSTRAINT uq_trx_task_tag_pair UNIQUE (task_id, tag_id)
);

CREATE INDEX IF NOT EXISTS ix_trx_task_tag_task_id
    ON trx_task_tag (task_id);
CREATE INDEX IF NOT EXISTS ix_trx_task_tag_tag_id
    ON trx_task_tag (tag_id);

-- =============================================================
-- trx_comment: コメントデータ
-- =============================================================
CREATE TABLE IF NOT EXISTS trx_comment (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id     INTEGER NOT NULL,
    content     TEXT    NOT NULL,
    created_at  TEXT    NOT NULL,
    CONSTRAINT fk_trx_comment_task_id
        FOREIGN KEY (task_id) REFERENCES trx_task (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ix_trx_comment_task_id
    ON trx_comment (task_id);

-- =============================================================
-- log_task: タスクログ
-- =============================================================
CREATE TABLE IF NOT EXISTS log_task (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id     INTEGER NOT NULL,
    action      TEXT    NOT NULL,
    details     TEXT,
    created_at  TEXT    NOT NULL,
    CONSTRAINT fk_log_task_task_id
        FOREIGN KEY (task_id) REFERENCES trx_task (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ix_log_task_task_id
    ON log_task (task_id);
CREATE INDEX IF NOT EXISTS ix_log_task_created_at
    ON log_task (created_at);
