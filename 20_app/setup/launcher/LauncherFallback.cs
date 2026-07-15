using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

internal static class LauncherFallback
{
    private const int StartupWatchMilliseconds = 10000;
    private static readonly string[] RequiredFiles = {
        "CotaskaCore.exe", "icudtl.dat", "resources.pak", "snapshot_blob.bin", "v8_context_snapshot.bin"
    };

    [DllImport("user32.dll")]
    private static extern bool AllowSetForegroundWindow(int processId);

    private static void AppendLauncherLog(string logPath, string message)
    {
        try { File.AppendAllText(logPath, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + " " + message + Environment.NewLine); }
        catch { /* Logging must never prevent recovery. */ }
    }

    private static List<string> GetMissingFiles(string appDirectory)
    {
        return RequiredFiles.Where(file => !File.Exists(Path.Combine(appDirectory, file))).ToList();
    }

    private static string FindLatestDebugError(string appDirectory)
    {
        string debugLog = Path.Combine(appDirectory, "debug.log");
        if (!File.Exists(debugLog)) return "debug.log はありません。";
        try
        {
            string[] lines = File.ReadAllLines(debugLog);
            string error = lines.Reverse().FirstOrDefault(line => line.IndexOf("error", StringComparison.OrdinalIgnoreCase) >= 0 || line.IndexOf("fatal", StringComparison.OrdinalIgnoreCase) >= 0);
            return String.IsNullOrWhiteSpace(error) ? "debug.log にエラー行は見つかりませんでした。" : error.Trim();
        }
        catch (Exception ex) { return "debug.log を読み取れません: " + ex.Message; }
    }

    private static string FindLatestBackup(string backupDirectory, string launcherLogPath)
    {
        if (!Directory.Exists(backupDirectory)) return null;
        try
        {
            // Current updater versions created directories; ZIP support is the portable recovery contract.
            var candidates = Directory.GetFiles(backupDirectory, "portable-update-before-*.zip")
                .Concat(Directory.GetDirectories(backupDirectory, "portable-update-before-*"))
                .OrderByDescending(path => File.GetLastWriteTime(path));
            foreach (string candidate in candidates)
            {
                if (IsValidBackup(candidate)) return candidate;
                AppendLauncherLog(launcherLogPath, "Ignored invalid recovery backup: " + candidate);
            }
        }
        catch (Exception ex) { AppendLauncherLog(launcherLogPath, "Backup search failed: " + ex.Message); }
        return null;
    }

    private static bool IsValidBackup(string backupPath)
    {
        try
        {
            if (Directory.Exists(backupPath)) return GetMissingFiles(Path.Combine(backupPath, "_app")).Count == 0;
            using (ZipArchive archive = ZipFile.OpenRead(backupPath))
            {
                return RequiredFiles.All(file => archive.Entries.Any(entry =>
                    entry.FullName.Replace('\\', '/').EndsWith("/_app/" + file, StringComparison.OrdinalIgnoreCase) ||
                    entry.FullName.Replace('\\', '/').Equals("_app/" + file, StringComparison.OrdinalIgnoreCase)));
            }
        }
        catch { return false; }
    }

    private static void OpenPath(string path)
    {
        try
        {
            if (File.Exists(path) || Directory.Exists(path)) Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
            else MessageBox.Show("対象がまだ作成されていません。\r\n" + path, "Cotaska ランチャー", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch (Exception ex) { MessageBox.Show("開けませんでした。\r\n" + ex.Message, "Cotaska ランチャー", MessageBoxButtons.OK, MessageBoxIcon.Error); }
    }

    private static List<Process> FindSameRootProcesses(string launcherDirectory)
    {
        string root = Path.GetFullPath(launcherDirectory).TrimEnd('\\') + "\\";
        int currentPid = Process.GetCurrentProcess().Id;
        var result = new List<Process>();
        foreach (string name in new[] { "Cotaska", "CotaskaCore" })
        {
            foreach (Process process in Process.GetProcessesByName(name))
            {
                try
                {
                    if (process.Id == currentPid) continue;
                    string fileName = Path.GetFullPath(process.MainModule.FileName);
                    if (fileName.StartsWith(root, StringComparison.OrdinalIgnoreCase)) result.Add(process);
                    else process.Dispose();
                }
                catch { process.Dispose(); }
            }
        }
        return result;
    }

    private static bool StopProcesses(IEnumerable<Process> processes, string launcherLogPath, out string error)
    {
        error = null;
        foreach (Process process in processes)
        {
            try
            {
                AppendLauncherLog(launcherLogPath, "Stopping same-root process: pid=" + process.Id);
                process.Kill();
                if (!process.WaitForExit(5000)) { error = "プロセスを終了できませんでした: PID " + process.Id; return false; }
            }
            catch (Exception ex) { error = "プロセス終了に失敗しました: PID " + process.Id + " (" + ex.Message + ")"; return false; }
            finally { process.Dispose(); }
        }
        return true;
    }

    private static void CopyDirectory(string sourceDirectory, string destinationDirectory)
    {
        Directory.CreateDirectory(destinationDirectory);
        foreach (string file in Directory.GetFiles(sourceDirectory)) File.Copy(file, Path.Combine(destinationDirectory, Path.GetFileName(file)), true);
        foreach (string directory in Directory.GetDirectories(sourceDirectory)) CopyDirectory(directory, Path.Combine(destinationDirectory, Path.GetFileName(directory)));
    }

    private static bool RestoreApp(string backupPath, string launcherDirectory, string launcherLogPath, out string error)
    {
        error = null;
        string tempRoot = Path.Combine(Path.GetTempPath(), "Cotaska-Recovery-" + Guid.NewGuid().ToString("N"));
        string oldApp = Path.Combine(launcherDirectory, "_app.recovery-before-" + DateTime.Now.ToString("yyyyMMdd-HHmmss"));
        string appTarget = Path.Combine(launcherDirectory, "_app");
        bool oldMoved = false;
        try
        {
            string sourceRoot;
            if (Directory.Exists(backupPath))
            {
                // Compatibility backups are directories. Copy first so the backup itself is never consumed or changed.
                sourceRoot = tempRoot;
                CopyDirectory(Path.Combine(backupPath, "_app"), Path.Combine(sourceRoot, "_app"));
            }
            else
            {
                ZipFile.ExtractToDirectory(backupPath, tempRoot);
                sourceRoot = Directory.Exists(Path.Combine(tempRoot, "Cotaska-Portable")) ? Path.Combine(tempRoot, "Cotaska-Portable") : tempRoot;
            }
            string sourceApp = Path.Combine(sourceRoot, "_app");
            List<string> missing = GetMissingFiles(sourceApp);
            if (missing.Count > 0) throw new InvalidDataException("バックアップ内の _app に必須ファイルがありません: " + String.Join(", ", missing));

            if (Directory.Exists(appTarget)) { Directory.Move(appTarget, oldApp); oldMoved = true; }
            Directory.Move(sourceApp, appTarget);
            missing = GetMissingFiles(appTarget);
            if (missing.Count > 0) throw new InvalidDataException("復元後の _app 検査に失敗しました: " + String.Join(", ", missing));
            AppendLauncherLog(launcherLogPath, "Recovery completed from " + backupPath + "; previous _app retained at " + oldApp);
            return true;
        }
        catch (Exception ex)
        {
            AppendLauncherLog(launcherLogPath, "Recovery failed: " + ex);
            try
            {
                if (Directory.Exists(appTarget)) Directory.Delete(appTarget, true);
                if (oldMoved && Directory.Exists(oldApp)) Directory.Move(oldApp, appTarget);
                AppendLauncherLog(launcherLogPath, "Recovery rollback completed.");
            }
            catch (Exception rollbackEx) { AppendLauncherLog(launcherLogPath, "Recovery rollback failed: " + rollbackEx); }
            error = ex.Message;
            return false;
        }
        finally
        {
            try { if (Directory.Exists(tempRoot)) Directory.Delete(tempRoot, true); } catch { }
        }
    }

    private static void ShowRecoveryDialog(string reason, string launcherDirectory, string launcherLogPath)
    {
        string backupDirectory = Path.Combine(launcherDirectory, "backup");
        string backup = FindLatestBackup(backupDirectory, launcherLogPath);
        using (Form form = new Form())
        using (TextBox details = new TextBox())
        using (Button restore = new Button())
        {
            form.Text = "Cotaska の起動を復旧";
            form.StartPosition = FormStartPosition.CenterScreen;
            form.ClientSize = new System.Drawing.Size(680, 360);
            form.MinimizeBox = false; form.MaximizeBox = false; form.FormBorderStyle = FormBorderStyle.FixedDialog;
            details.Multiline = true; details.ReadOnly = true; details.ScrollBars = ScrollBars.Vertical; details.BorderStyle = BorderStyle.FixedSingle;
            details.SetBounds(16, 16, 648, 240);
            details.Text = "Cotaska を起動できませんでした。\r\n\r\n検出内容:\r\n" + reason + "\r\n\r\n"
                + (backup == null ? "有効な更新前バックアップはありません。再配布パッケージから手動で _app を復旧してください。" : "利用可能な更新前バックアップ:\r\n" + backup + "\r\n\r\n自動復元は _app のみを置き換えます。data/、logs/、backup/ は変更しません。") ;
            restore.Text = "自動復元へ進む"; restore.SetBounds(16, 285, 145, 32); restore.Enabled = backup != null;
            Button openBackup = new Button { Text = "バックアップを開く" }; openBackup.SetBounds(170, 285, 130, 32);
            Button openLogs = new Button { Text = "エラーログを開く" }; openLogs.SetBounds(309, 285, 130, 32);
            Button close = new Button { Text = "閉じる", DialogResult = DialogResult.Cancel }; close.SetBounds(548, 285, 116, 32);
            openBackup.Click += (sender, args) => OpenPath(backupDirectory);
            openLogs.Click += (sender, args) => { OpenPath(launcherLogPath); string debug = Path.Combine(launcherDirectory, "_app", "debug.log"); if (File.Exists(debug)) OpenPath(debug); };
            restore.Click += (sender, args) =>
            {
                List<Process> processes = FindSameRootProcesses(launcherDirectory);
                string processList = processes.Count == 0 ? "同一 Portable ルートで実行中の Cotaska プロセスはありません。" : "終了対象:\r\n" + String.Join("\r\n", processes.Select(p => p.ProcessName + " (PID " + p.Id + ")"));
                DialogResult confirmed = MessageBox.Show("次のバックアップから _app のみを復元します。\r\n" + backup + "\r\ndata/、logs/、backup/ は変更しません。\r\n\r\n" + processList + "\r\n\r\n続行しますか？", "自動復元の確認", MessageBoxButtons.OKCancel, MessageBoxIcon.Warning);
                if (confirmed != DialogResult.OK) { foreach (Process p in processes) p.Dispose(); return; }
                string stopError;
                if (!StopProcesses(processes, launcherLogPath, out stopError)) { MessageBox.Show(stopError, "Cotaska の復元", MessageBoxButtons.OK, MessageBoxIcon.Error); return; }
                string restoreError;
                if (!RestoreApp(backup, launcherDirectory, launcherLogPath, out restoreError)) { MessageBox.Show("復元に失敗しました。元の _app へのロールバックを試みました。\r\n\r\n" + restoreError, "Cotaska の復元", MessageBoxButtons.OK, MessageBoxIcon.Error); return; }
                if (MessageBox.Show("_app の復元と必須ファイル検査が完了しました。\r\nCotaska を起動しますか？", "Cotaska の復元", MessageBoxButtons.YesNo, MessageBoxIcon.Information) == DialogResult.Yes) StartChild(launcherDirectory, launcherLogPath, false);
                form.Close();
            };
            form.Controls.AddRange(new Control[] { details, restore, openBackup, openLogs, close });
            form.CancelButton = close;
            form.ShowDialog();
        }
    }

    private static bool StartChild(string launcherDirectory, string launcherLogPath, bool watchForEarlyExit)
    {
        string target = Path.Combine(launcherDirectory, "_app", "CotaskaCore.exe");
        try
        {
            using (Process process = new Process())
            {
                process.StartInfo.FileName = target; process.StartInfo.WorkingDirectory = Path.GetDirectoryName(target) ?? launcherDirectory;
                process.StartInfo.UseShellExecute = false; process.StartInfo.CreateNoWindow = true; process.StartInfo.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
                process.Start(); AllowSetForegroundWindow(process.Id); AppendLauncherLog(launcherLogPath, "Child started: pid=" + process.Id);
                if (!watchForEarlyExit || !process.WaitForExit(StartupWatchMilliseconds)) { AppendLauncherLog(launcherLogPath, "Child passed startup watch."); return true; }
                string detail = "CotaskaCore.exe が起動後 " + StartupWatchMilliseconds / 1000 + " 秒以内に終了しました。終了コード: " + process.ExitCode + "\r\n最新の debug.log エラー: " + FindLatestDebugError(Path.Combine(launcherDirectory, "_app"));
                AppendLauncherLog(launcherLogPath, detail); ShowRecoveryDialog(detail, launcherDirectory, launcherLogPath); return false;
            }
        }
        catch (Exception ex) { AppendLauncherLog(launcherLogPath, "Child start failed: " + ex); ShowRecoveryDialog("CotaskaCore.exe を開始できませんでした。\r\n" + ex.Message, launcherDirectory, launcherLogPath); return false; }
    }

    [STAThread]
    private static int Main()
    {
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        string launcherDirectory = Path.GetDirectoryName(Application.ExecutablePath) ?? AppDomain.CurrentDomain.BaseDirectory;
        string launcherLogPath = Path.Combine(launcherDirectory, "launcher.log");
        AppendLauncherLog(launcherLogPath, "Launcher start: " + Application.ExecutablePath);
        List<string> missing = GetMissingFiles(Path.Combine(launcherDirectory, "_app"));
        if (missing.Count > 0) { string reason = "_app に必須ファイルがありません:\r\n" + String.Join("\r\n", missing); AppendLauncherLog(launcherLogPath, reason); ShowRecoveryDialog(reason, launcherDirectory, launcherLogPath); return 1; }
        return StartChild(launcherDirectory, launcherLogPath, true) ? 0 : 1;
    }
}
