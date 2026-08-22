using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Threading;
using System.Windows.Forms;

internal static class UpdaterFallback
{
    private sealed class Options
    {
        public string ZipPath;
        public string PortableRoot;
        public string Version;
    }

    private static string workLogPath;
    private static string portableLogPath;
    private static UpdaterStatusWindow statusWindow;
    private static int updateExitCode;
    private static bool allowStatusWindowClose;

    [STAThread]
    private static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        statusWindow = new UpdaterStatusWindow();
        statusWindow.Shown += delegate { StartUpdateWorker(args); };
        Application.Run(statusWindow);
        return updateExitCode;
    }

    private static void StartUpdateWorker(string[] args)
    {
        var worker = new Thread(() =>
        {
            updateExitCode = RunUpdate(args);
            CloseStatusWindow();
        });
        worker.Start();
    }

    private static int RunUpdate(string[] args)
    {
        string timestamp = DateTime.Now.ToString("yyyyMMdd_HHmmss");
        string extractRoot = Path.Combine(Path.GetTempPath(), "Cotaska-update-extract-" + timestamp);
        string backupWorkRoot = Path.Combine(Path.GetTempPath(), "Cotaska-update-backup-" + timestamp);
        string backupPath = null;

        try
        {
            SetStatus("更新を開始しています...");
            Options options = ParseOptions(args);
            string exeDir = Path.GetDirectoryName(Process.GetCurrentProcess().MainModule.FileName) ?? AppDomain.CurrentDomain.BaseDirectory;
            string logDir = Path.Combine(options.PortableRoot, "logs");
            workLogPath = Path.Combine(exeDir, "portable-update-" + timestamp + ".log");
            portableLogPath = Path.Combine(logDir, "portable-update-" + timestamp + ".log");

            WriteLog("Portable update started. Version=" + (options.Version ?? ""));
            WriteLog("Portable root: " + options.PortableRoot);
            WriteLog("Zip path: " + options.ZipPath);

            if (!Directory.Exists(options.PortableRoot))
            {
                throw new DirectoryNotFoundException("Portable root was not found: " + options.PortableRoot);
            }
            if (!File.Exists(options.ZipPath))
            {
                throw new FileNotFoundException("Update zip was not found: " + options.ZipPath);
            }

            SetStatus("Cotaska の終了を待っています...");
            WaitForCotaskaExit(options.PortableRoot);

            SetStatus("更新ファイルを展開しています...");
            DeleteDirectoryIfExists(extractRoot);
            Directory.CreateDirectory(extractRoot);
            ZipFile.ExtractToDirectory(options.ZipPath, extractRoot);

            SetStatus("更新内容を確認しています...");
            string sourceRoot = Path.Combine(extractRoot, "Cotaska-Portable");
            ValidateSourceRoot(sourceRoot);

            SetStatus("現在のファイルをバックアップしています...");
            string backupDir = Path.Combine(options.PortableRoot, "backup");
            Directory.CreateDirectory(backupDir);
            DeleteDirectoryIfExists(backupWorkRoot);
            Directory.CreateDirectory(backupWorkRoot);
            backupPath = Path.Combine(backupWorkRoot, "current");
            Directory.CreateDirectory(backupPath);
            WriteLog("Creating backup: " + backupPath);
            BackupCurrentFiles(options.PortableRoot, backupPath);
            string backupArchivePath = Path.Combine(backupDir, "portable-update-before-" + timestamp + ".zip");
            WriteLog("Creating backup archive: " + backupArchivePath);
            CreateBackupArchive(backupPath, backupArchivePath);

            SetStatus("アプリを差し替えています...");
            WriteLog("Replacing application files");
            ReplaceApplicationFiles(options.PortableRoot, sourceRoot);

            SetStatus("Cotaska を再起動しています...");
            WriteLog("Portable update completed");
            RestartCotaska(options.PortableRoot);
            WriteLog("Cotaska restart requested");
            SetStatus("更新が完了しました。");
            Thread.Sleep(600);
            return 0;
        }
        catch (Exception ex)
        {
            SetStatus("更新に失敗しました。ログを確認してください。");
            WriteLog("Portable update failed: " + ex.Message);
            if (!string.IsNullOrEmpty(backupPath))
            {
                try
                {
                    SetStatus("バックアップから復元しています...");
                    RestoreFromBackup(backupPath, GetPortableRootFromArgs(args));
                }
                catch (Exception restoreEx)
                {
                    WriteLog("Restore failed: " + restoreEx.Message);
                }
            }
            ShowFailure(ex.Message);
            return 1;
        }
        finally
        {
            DeleteDirectoryIfExists(extractRoot);
            DeleteDirectoryIfExists(backupWorkRoot);
        }
    }

    private static void ShowFailure(string message)
    {
        UpdaterStatusWindow window = statusWindow;
        if (window == null || window.IsDisposed)
        {
            MessageBox.Show(message, "Cotaska Update Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }
        try
        {
            Action show = () =>
            {
                CloseStatusWindow();
                MessageBox.Show(message, "Cotaska Update Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            };
            if (window.InvokeRequired)
            {
                window.Invoke(show);
                return;
            }
            show();
        }
        catch
        {
            MessageBox.Show(message, "Cotaska Update Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private static void SetStatus(string message)
    {
        UpdaterStatusWindow window = statusWindow;
        if (window == null || window.IsDisposed)
        {
            return;
        }
        try
        {
            if (window.InvokeRequired)
            {
                window.BeginInvoke(new Action<string>(SetStatus), message);
                return;
            }
            window.SetStatus(message);
        }
        catch
        {
            // The update itself must continue even if the status window is unavailable.
        }
    }

    private static void CloseStatusWindow()
    {
        UpdaterStatusWindow window = statusWindow;
        if (window == null || window.IsDisposed)
        {
            return;
        }
        try
        {
            if (window.InvokeRequired)
            {
                window.BeginInvoke(new Action(CloseStatusWindow));
                return;
            }
            allowStatusWindowClose = true;
            window.Close();
            Application.ExitThread();
        }
        catch
        {
            Application.ExitThread();
        }
    }

    private static Options ParseOptions(string[] args)
    {
        var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        for (int i = 0; i < args.Length; i++)
        {
            string key = args[i];
            if (!key.StartsWith("--", StringComparison.Ordinal) || i + 1 >= args.Length)
            {
                continue;
            }
            values[key.Substring(2)] = args[++i];
        }

        var options = new Options
        {
            ZipPath = GetRequired(values, "zip"),
            PortableRoot = GetRequired(values, "portable-root"),
            Version = values.ContainsKey("version") ? values["version"] : ""
        };
        return options;
    }

    private static string GetPortableRootFromArgs(string[] args)
    {
        try
        {
            return ParseOptions(args).PortableRoot;
        }
        catch
        {
            return null;
        }
    }

    private static string GetRequired(Dictionary<string, string> values, string key)
    {
        string value;
        if (!values.TryGetValue(key, out value) || string.IsNullOrWhiteSpace(value))
        {
            throw new ArgumentException("Missing required option: --" + key);
        }
        return Path.GetFullPath(value);
    }

    private static void WriteLog(string message)
    {
        string line = "[" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "] " + message + Environment.NewLine;
        TryAppend(workLogPath, line);
        TryAppend(portableLogPath, line);
    }

    private static void TryAppend(string path, string line)
    {
        if (string.IsNullOrEmpty(path))
        {
            return;
        }
        try
        {
            string dir = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(dir))
            {
                Directory.CreateDirectory(dir);
            }
            File.AppendAllText(path, line);
        }
        catch
        {
            // Updater execution should continue even when one log destination is unavailable.
        }
    }

    private static void WaitForCotaskaExit(string portableRoot)
    {
        for (int i = 0; i < 120; i++)
        {
            List<Process> running = GetCotaskaProcesses(portableRoot);
            if (running.Count == 0)
            {
                return;
            }
            if (i == 0 || i % 10 == 0)
            {
                WriteLog("Waiting for Cotaska processes: " + string.Join(", ", running.Select(p => p.ProcessName + "#" + p.Id).ToArray()));
            }
            System.Threading.Thread.Sleep(1000);
        }

        List<Process> remaining = GetCotaskaProcesses(portableRoot);
        if (remaining.Count > 0)
        {
            throw new InvalidOperationException("Cotaska process is still running: " + string.Join(", ", remaining.Select(p => p.ProcessName + "#" + p.Id).ToArray()));
        }
    }

    private static List<Process> GetCotaskaProcesses(string portableRoot)
    {
        string rootPrefix = EnsureTrailingSeparator(Path.GetFullPath(portableRoot));
        var result = new List<Process>();
        foreach (string name in new[] { "Cotaska", "CotaskaCore" })
        {
            foreach (Process process in Process.GetProcessesByName(name))
            {
                try
                {
                    string path = process.MainModule.FileName;
                    if (!string.IsNullOrEmpty(path) && path.StartsWith(rootPrefix, StringComparison.OrdinalIgnoreCase))
                    {
                        result.Add(process);
                    }
                    else
                    {
                        process.Dispose();
                    }
                }
                catch
                {
                    process.Dispose();
                }
            }
        }
        return result;
    }

    private static string EnsureTrailingSeparator(string path)
    {
        if (path.EndsWith(Path.DirectorySeparatorChar.ToString(), StringComparison.Ordinal))
        {
            return path;
        }
        return path + Path.DirectorySeparatorChar;
    }

    private static void ValidateSourceRoot(string sourceRoot)
    {
        if (!Directory.Exists(sourceRoot))
        {
            throw new DirectoryNotFoundException("Cotaska-Portable root was not found in update zip.");
        }
        foreach (string required in new[] { "Cotaska.exe", "_app", Path.Combine("_app", "resources", "app.asar") })
        {
            string path = Path.Combine(sourceRoot, required);
            if (!File.Exists(path) && !Directory.Exists(path))
            {
                throw new FileNotFoundException("Required update item was not found: " + required);
            }
        }
    }

    private static void BackupCurrentFiles(string portableRoot, string backupPath)
    {
        CopyFileIfExists(Path.Combine(portableRoot, "Cotaska.exe"), Path.Combine(backupPath, "Cotaska.exe"));
        CopyDirectoryIfExists(Path.Combine(portableRoot, "_app"), Path.Combine(backupPath, "_app"));
        CopyDirectoryIfExists(Path.Combine(portableRoot, "tools"), Path.Combine(backupPath, "tools"));
        CopyMatchingFiles(portableRoot, backupPath, "Cotaska_AI*.md");
        CopyFileIfExists(Path.Combine(portableRoot, "README.md"), Path.Combine(backupPath, "README.md"));
    }

    private static void CreateBackupArchive(string backupPath, string backupArchivePath)
    {
        string archiveDir = Path.GetDirectoryName(backupArchivePath);
        if (!string.IsNullOrEmpty(archiveDir))
        {
            Directory.CreateDirectory(archiveDir);
        }
        if (File.Exists(backupArchivePath))
        {
            File.Delete(backupArchivePath);
        }
        ZipFile.CreateFromDirectory(backupPath, backupArchivePath, CompressionLevel.Optimal, false);
        if (!File.Exists(backupArchivePath))
        {
            throw new IOException("Backup archive was not created: " + backupArchivePath);
        }
    }

    private static void ReplaceApplicationFiles(string portableRoot, string sourceRoot)
    {
        File.Copy(Path.Combine(sourceRoot, "Cotaska.exe"), Path.Combine(portableRoot, "Cotaska.exe"), true);
        ReplaceDirectory(Path.Combine(sourceRoot, "_app"), Path.Combine(portableRoot, "_app"));
        string sourceTools = Path.Combine(sourceRoot, "tools");
        if (Directory.Exists(sourceTools))
        {
            ReplaceDirectory(sourceTools, Path.Combine(portableRoot, "tools"));
        }
        CopyMatchingFiles(sourceRoot, portableRoot, "Cotaska_AI*.md");
        CopyFileIfExists(Path.Combine(sourceRoot, "README.md"), Path.Combine(portableRoot, "README.md"));
    }

    private static void RestoreFromBackup(string backupPath, string portableRoot)
    {
        if (string.IsNullOrEmpty(portableRoot) || !Directory.Exists(backupPath))
        {
            return;
        }
        WriteLog("Restoring from backup: " + backupPath);
        CopyFileIfExists(Path.Combine(backupPath, "Cotaska.exe"), Path.Combine(portableRoot, "Cotaska.exe"));
        CopyDirectoryIfExists(Path.Combine(backupPath, "_app"), Path.Combine(portableRoot, "_app"));
        CopyDirectoryIfExists(Path.Combine(backupPath, "tools"), Path.Combine(portableRoot, "tools"));
        CopyMatchingFiles(backupPath, portableRoot, "Cotaska_AI*.md");
        CopyFileIfExists(Path.Combine(backupPath, "README.md"), Path.Combine(portableRoot, "README.md"));
    }

    private static void RestartCotaska(string portableRoot)
    {
        string exePath = Path.Combine(portableRoot, "Cotaska.exe");
        if (!File.Exists(exePath))
        {
            throw new FileNotFoundException("Cotaska.exe was not found after update: " + exePath);
        }
        Process.Start(new ProcessStartInfo
        {
            FileName = exePath,
            WorkingDirectory = portableRoot,
            UseShellExecute = true
        });
    }

    private static void ReplaceDirectory(string source, string destination)
    {
        DeleteDirectoryIfExists(destination);
        CopyDirectory(source, destination);
    }

    private static void CopyDirectoryIfExists(string source, string destination)
    {
        if (Directory.Exists(source))
        {
            CopyDirectory(source, destination);
        }
    }

    private static void CopyDirectory(string source, string destination)
    {
        Directory.CreateDirectory(destination);
        foreach (string dir in Directory.GetDirectories(source, "*", SearchOption.AllDirectories))
        {
            Directory.CreateDirectory(Path.Combine(destination, GetRelativePath(source, dir)));
        }
        foreach (string file in Directory.GetFiles(source, "*", SearchOption.AllDirectories))
        {
            string target = Path.Combine(destination, GetRelativePath(source, file));
            string targetDir = Path.GetDirectoryName(target);
            if (!string.IsNullOrEmpty(targetDir))
            {
                Directory.CreateDirectory(targetDir);
            }
            File.Copy(file, target, true);
        }
    }

    private static string GetRelativePath(string root, string path)
    {
        Uri rootUri = new Uri(EnsureTrailingSeparator(Path.GetFullPath(root)));
        Uri pathUri = new Uri(Path.GetFullPath(path));
        return Uri.UnescapeDataString(rootUri.MakeRelativeUri(pathUri).ToString()).Replace('/', Path.DirectorySeparatorChar);
    }

    private static void CopyMatchingFiles(string sourceDir, string destinationDir, string pattern)
    {
        if (!Directory.Exists(sourceDir))
        {
            return;
        }
        foreach (string file in Directory.GetFiles(sourceDir, pattern, SearchOption.TopDirectoryOnly))
        {
            CopyFileIfExists(file, Path.Combine(destinationDir, Path.GetFileName(file)));
        }
    }

    private static void CopyFileIfExists(string source, string destination)
    {
        if (!File.Exists(source))
        {
            return;
        }
        string dir = Path.GetDirectoryName(destination);
        if (!string.IsNullOrEmpty(dir))
        {
            Directory.CreateDirectory(dir);
        }
        File.Copy(source, destination, true);
    }

    private static void DeleteDirectoryIfExists(string path)
    {
        if (!string.IsNullOrEmpty(path) && Directory.Exists(path))
        {
            Directory.Delete(path, true);
        }
    }

    private sealed class UpdaterStatusWindow : Form
    {
        private readonly Label statusLabel;
        private readonly ProgressBar progressBar;

        public UpdaterStatusWindow()
        {
            Text = "Cotaska を更新しています";
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            MinimizeBox = true;
            ShowInTaskbar = true;
            TopMost = true;
            ClientSize = new Size(420, 150);
            BackColor = Color.White;

            var titleLabel = new Label
            {
                AutoSize = false,
                Text = "Cotaska を更新しています",
                Font = new Font("Yu Gothic UI", 13F, FontStyle.Bold),
                Location = new Point(24, 18),
                Size = new Size(372, 28)
            };
            Controls.Add(titleLabel);

            statusLabel = new Label
            {
                AutoSize = false,
                Text = "更新ファイルを適用しています。しばらくお待ちください。",
                Font = new Font("Yu Gothic UI", 9F, FontStyle.Regular),
                Location = new Point(24, 56),
                Size = new Size(372, 24)
            };
            Controls.Add(statusLabel);

            progressBar = new ProgressBar
            {
                Location = new Point(24, 92),
                Size = new Size(372, 18),
                Style = ProgressBarStyle.Marquee,
                MarqueeAnimationSpeed = 35
            };
            Controls.Add(progressBar);

            var noteLabel = new Label
            {
                AutoSize = false,
                Text = "×で閉じても更新は継続します。完了後にCotaskaを再起動します。",
                Font = new Font("Yu Gothic UI", 8F, FontStyle.Regular),
                ForeColor = Color.DimGray,
                Location = new Point(24, 118),
                Size = new Size(372, 20)
            };
            Controls.Add(noteLabel);
        }

        public void SetStatus(string message)
        {
            statusLabel.Text = message;
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (e.CloseReason == CloseReason.UserClosing && !allowStatusWindowClose)
            {
                e.Cancel = true;
                Hide();
                return;
            }
            base.OnFormClosing(e);
        }
    }
}
