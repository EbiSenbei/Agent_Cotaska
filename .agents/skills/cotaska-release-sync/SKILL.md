---
name: cotaska-release-sync
description: Build the current Cotaska Portable release and synchronize it to the repository's task-master distribution. Always use when the user says「ビルド＋この環境へリリースするスキル」「ビルド＋この環境へリリース」「この環境へリリース」or asks to rebuild Cotaska and reflect it into the current local task-master environment, including requests to run `20_app/release-all.ps1` followed by `20_app/sync-task-master-release.ps1`. Do not use for R2 or GitHub Release uploads unless separately requested.
---

# Cotaska Release Sync

Run the repository's existing release and synchronization scripts in a fixed, fail-safe order.

## Workflow

1. Work from the Cotaska repository root. Locate it from the current workspace; do not assume a drive letter or clone location.
2. Read these files before execution:
   - `00_mgmt/Cotaska_タスク管理ツール/data/tasks/_index.yaml`
   - `10_docs/10_運用ルール/リリースプロセスルール.md`
3. Confirm that these files exist:
   - `20_app/package.json`
   - `20_app/release-all.ps1`
   - `20_app/sync-task-master-release.ps1`
4. Read `version` from `20_app/package.json`. Report the version and current `git status -sb`. A dirty worktree is allowed when the user intends to package current local work, but explicitly state that those changes will be included.
5. From `20_app`, run the release script with the version explicitly supplied:

   ```powershell
   powershell -ExecutionPolicy Bypass -File '.\release-all.ps1' -Version '<package-version>'
   ```

6. Continue only when the release command exits with code 0 and its shipment checks complete successfully. On failure, stop and report the failed stage; never synchronize an incomplete release.
7. Tell the user that synchronization stops running Cotaska-related processes and creates a backup. Then run from `20_app`:

   ```powershell
   powershell -ExecutionPolicy Bypass -File '.\sync-task-master-release.ps1'
   ```

8. Confirm exit code 0. Capture the backup ZIP path printed by the script.
9. Verify and report:
   - `20_app/release/Cotaska-Portable.zip` exists.
   - Its SHA-256 hash.
   - The reported backup ZIP exists.
   - Final `git status -sb`, noting generated tracked changes such as `20_app/scripts/CotaskaUpdater.exe` without modifying or committing them unless requested.

## Safety

- Preserve the sequence: release first, synchronize second.
- Never run synchronization after a release failure.
- Do not edit task `_index.yaml` manually.
- Do not upload to R2 or GitHub Releases as part of this skill.
- Do not commit generated changes unless the user explicitly asks.
