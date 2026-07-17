---
name: cotaska-release-r2
description: Build the current Cotaska Portable release and publish its ZIP, SHA-256, and version metadata to Cloudflare R2. Use only when the user explicitly asks to run `20_app/release-all.ps1` followed by `20_app/upload-r2.ps1`, publish or upload the latest Cotaska release to R2, or update the public Cotaska `latest/` release. Do not use for task-master synchronization or GitHub Releases.
---

# Cotaska Release to R2

Build and validate one Cotaska release, then publish that exact build to R2.

## Workflow

1. Work from the Cotaska repository root. Locate it from the current workspace; do not assume a drive letter or clone location.
2. Read before execution:
   - `00_mgmt/Cotaska_タスク管理ツール/data/tasks/_index.yaml`
   - `10_docs/10_運用ルール/リリースプロセスルール.md`
3. Confirm that these files exist:
   - `20_app/package.json`
   - `20_app/release-all.ps1`
   - `20_app/upload-r2.ps1`
   - `20_app/config/r2-upload.local.json`
4. Never print or summarize the R2 configuration contents. It contains credentials.
5. Read `version` from `20_app/package.json`. Report the version and current `git status -sb`. A dirty worktree is allowed when the user intends to publish current local work, but explicitly state that those changes will be included.
6. From `20_app`, run the release script with the version explicitly supplied:

   ```powershell
   powershell -ExecutionPolicy Bypass -File '.\release-all.ps1' -Version '<package-version>'
   ```

7. Continue only when the release command exits with code 0 and all shipment checks complete successfully. On failure, stop; never upload an incomplete release.
8. Confirm that both files exist and that the recorded hash matches the ZIP:
   - `release/Cotaska-Portable.zip`
   - `release/Cotaska-Portable.zip.sha256`
9. Tell the user that the next step publishes externally to the R2 `latest/` prefix. The user's explicit request to invoke this skill supplies authorization. Then run:

   ```powershell
   powershell -ExecutionPolicy Bypass -File '.\upload-r2.ps1'
   ```

10. Confirm exit code 0. Verify the script reports the same package version and successful public checks for:
    - `latest/Cotaska-Portable.zip`
    - `latest/Cotaska-Portable.zip.sha256`
    - `latest/version.json`
11. Report the public URLs, ZIP byte size, SHA-256, version, and final `git status -sb`. Note generated tracked changes such as `20_app/scripts/CotaskaUpdater.exe` without modifying or committing them unless requested.

## Safety

- Preserve the sequence: release first, R2 upload second.
- Never upload after a release or hash-verification failure.
- Do not expose credentials or configuration values.
- Do not synchronize the task-master distribution as part of this skill.
- Do not upload to GitHub Releases.
- Do not commit generated changes unless the user explicitly asks.
