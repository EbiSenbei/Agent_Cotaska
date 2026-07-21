# AGENTS.md

## Purpose

This repository contains a local desktop task management system designed for collaboration between human developers and AI agents.

All agents must follow this file before changing source code, task data, or project configuration.

Goals:
- Keep operations safe and predictable.
- Preserve task data integrity.
- Make AI work auditable for humans.

Primary task management rule reference:
- `00_mgmt/Cotaska_タスク管理ツール/Cotaska_AIエージェント運用ルール.md`
- For task management behavior, this rule has priority over this file when guidance overlaps.

---

## System Overview

Main components:
- Desktop app: Electron + React
- Task source of truth: `data/tasks/T-XXX.md`
- YAML index mirror: `data/tasks/_index.yaml`
- List master: `data/lists.yaml`
- Management docs: `00_mgmt/`

Critical rule:
- Task files under `data/tasks/` are the source of truth.
- `data/tasks/_index.yaml` is generated output. Do not edit it manually.

---

## Required Workflow

Agents must execute work in this order:
1. Read `data/tasks/_index.yaml` to get the current task list.
2. Identify target task(s).
3. Open corresponding task file(s) under `data/tasks/`.
4. Work only on tasks with `status: todo` or `status: doing` unless explicitly instructed.
5. After work, update task frontmatter (and `_index.yaml` if app is not running).
6. Record important technical decisions in `00_mgmt/DECISIONS.md`.

---

## Spec Change Protocol

When the user requests a specification change (仕様変更), agents must follow
`10_docs/10_運用ルール/仕様変更管理ルール.md` before implementation.

Minimum required task files to create in `data/tasks/`:
1. Check whether design-doc updates are required; if required, add and execute design update tasks.
2. Add and execute implementation tasks.
3. Add and execute user confirmation tasks.

Do not mark a spec change complete until these task groups are reflected and tracked.

---

## Editing Rules

Allowed:
- Source code changes in application folders
- Documentation updates
- Task file read/write in `data/tasks/`
- List master update in `data/lists.yaml`

Not allowed:
- Manual edits to `data/tasks/_index.yaml`
- Creating duplicate task IDs
- Breaking YAML frontmatter syntax
- Deleting task files without moving them to `data/archive/`
- Deleting historical logs or management records

---

## Git / Commit Rules

- コミットメッセージは必ず日本語で記載する。
- Commit messages must always be written in Japanese.
- Do not use English commit messages unless the user explicitly requests it.
- 仕様変更のコミットメッセージは、先頭に仕様変更IDを含め、続けて仕様変更の概要を日本語で記載する。
  - 例: `CHG-046 ドラッグハンドル並び替えを実装`
- 不具合対応のコミットメッセージは、先頭にバグレポートIDを含め、続けて不具合対応の概要を日本語で記載する。
  - 例: `BUG-20260326-01 起動時に画面が表示されない問題を修正`

---

## Task Update Rules

When a task is completed:
1. Update task frontmatter fields:
   - `status: done`
   - `completed_at`
   - `updated_at`
2. Add key decision notes to `00_mgmt/DECISIONS.md` when relevant.

---

## Task File Format

Each task file is `data/tasks/T-XXX.md` with YAML frontmatter.

```yaml
---
id: T-001
title: タスク名
status: todo|doing|blocked|done
priority: high|medium|normal
progress_status: 未着|仕掛|保留|完了
due_date: 2026-03-20   # or null
list: リスト名         # null means no list
parent: null           # parent task id (T-XXX) or null
tags: []
sort_order: 10
delete_flag: 0
created_at: 2026-03-18T10:00:00
updated_at: 2026-03-18T10:00:00
completed_at: null
deleted_at: null
---
タスク本文（Markdown）
```

---

## Bug Fix Reporting Workflow

When fixing production-impacting defects, record the process with traceability.

Steps:
1. Confirm the bug report in `10_docs/10_運用ルール/バグレポート管理ルール.md`.
2. Create a report file under `10_docs/30_変更管理/20_バグレポート/`.
3. After validation, update the report with final result and close condition.

Naming rule for bug reports:
- `YYYYMMDD_連番_タイトル.md`

---

## Coding Standards

General guidelines:
- Prefer simple and maintainable solutions.
- Avoid unnecessary dependencies.
- Keep functions readable and focused.
- Use explicit and meaningful names.
- Add concise comments only where logic is non-obvious.

---

## Safety Rules

Agents must never:
- delete databases or task source data
- overwrite critical config without explicit instruction
- remove historical records
- run destructive migrations without approval

---

## IPC Channel Rules (Main <-> Renderer)

This project uses a preload bridge API with context isolation enabled.

Security assumptions:
- `contextIsolation: true`
- `nodeIntegration: false`
- Renderer should use only the exposed bridge API

Bridge namespace:
- `window.cotaskaAPI`

### Task API Examples

Get all active tasks:
```javascript
window.cotaskaAPI.tasks.getAll()
```

Add a task:
```javascript
window.cotaskaAPI.tasks.add({
  title: "タスク名",
  priority: "medium",
  due_date: "2026-03-20",
  list: "リスト名",
  parent: null,
})
```

Update a task:
```javascript
window.cotaskaAPI.tasks.update({
  id: "T-001",
  title: "更新後タイトル",
  status: "doing",
  progress_status: "仕掛",
})
```

---

## Final Notes

If any instruction conflicts with direct user requests, follow user requests first, then record the deviation in `00_mgmt/DECISIONS.md` when needed.

---

## Project Skills

- CotaskaのPortableリリース生成後にタスクマスター配布先へ同期する場合は、`.agents/skills/cotaska-release-sync/SKILL.md`に従う。
- CotaskaのPortableリリース生成後にCloudflare R2の`latest/`へ公開する場合は、`.agents/skills/cotaska-release-r2/SKILL.md`に従う。
- ユーザーが「リリース＋クラウドフレアにアップロード」「リリース＋Cloudflareにアップロード」「クラウドフレアにアップロード」と指示した場合は、`cotaska-release-r2`の明示的な呼び出しとして扱う。

---

## GitHub Release Upload Rules

## Version Upgrade Release Notes

When the user requests a version upgrade or release, always read and follow:

- `10_docs/10_運用ルール/リリースプロセスルール.md`

Before completing the release, create or update the release note in
`10_docs/30_変更管理/50_リリース/` using the filename format
`YYYYMMDD_v<version>_リリースノート.md`.

Before uploading assets to GitHub Releases, always refer to:
- `10_docs/10_運用ルール/リリースプロセスルール.md`

Upload both distribution lines when publishing a Cotaska release:
- Portable/manual distribution: `20_app/release/Cotaska-Portable.zip`
- NSIS installer / auto-update distribution: `CotaskaCore-<version>-win-x64.exe`, `CotaskaCore-<version>-win-x64.exe.blockmap`, and `latest.yml`

The NSIS `.exe`, `.blockmap`, and `latest.yml` must come from the same build and must be uploaded together.
