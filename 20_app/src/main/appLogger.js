const fs = require('fs');
const path = require('path');
const os = require('os');

const LOG_LEVEL_PRIORITY = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/**
 * AppLogger - アプリ実行ログ
 * アプリのシステムヘルス記録
 * 常に有効（開発／本番環境どちらでも出力）
 */
class AppLogger {
  constructor() {
    const bootstrapRoot = process.env.LOCALAPPDATA || process.env.APPDATA || os.tmpdir();
    this.logDir = path.join(bootstrapRoot, 'Cotaska', 'logs');
    this.logFile = null;
    this.startTime = null;
    
    console.log('[AppLogger] Initializing', {
      logDir: this.logDir
    });
    
    try {
      this._ensureLogDir();
      this._openLogFile();
    } catch (err) {
      this.logFilePath = null;
      console.error('[AppLogger] Bootstrap logger initialization failed:', err.message);
    }
    console.log('[AppLogger] Logger initialized');
  }

  configureLogDir(logDir) {
    try {
      this.logDir = path.resolve(logDir);
      this._ensureLogDir();
      this._openLogFile();
      return true;
    } catch (err) {
      console.error('[AppLogger] Failed to configure log directory:', err.message);
      return false;
    }
  }

  /**
   * ログディレクトリを確保
   */
  _ensureLogDir() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
    // 古いログファイルをクリーンアップ
    this._cleanupOldLogs();
  }

  /**
   * 30日以上前のログファイルをクリーンアップ
   */
  _cleanupOldLogs() {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      fs.readdirSync(this.logDir).forEach((file) => {
        const filePath = path.join(this.logDir, file);
        const stat = fs.statSync(filePath);

        if (stat.isFile() && stat.mtime < thirtyDaysAgo) {
          fs.unlinkSync(filePath);
          console.log(`[AppLogger] Deleted old log file: ${file}`);
        }
      });
    } catch (err) {
      console.error('[AppLogger] Error during log cleanup:', err.message);
    }
  }

  /**
   * ログファイルをオープン（本日分）
   */
  _openLogFile() {
    const today = new Date().toISOString().slice(0, 10);
    const filename = `app-${today}.log`;
    this.logFilePath = path.join(this.logDir, filename);
  }

  _getConfiguredLevel() {
    try {
      const settingsService = require("./settingsService");
      const settings = settingsService.getSettings().settings;
      const level = String(settings?.logging?.level || "info").toLowerCase();
      return Object.prototype.hasOwnProperty.call(LOG_LEVEL_PRIORITY, level) ? level : "info";
    } catch (_err) {
      return "info";
    }
  }

  _shouldWrite(level) {
    const current = LOG_LEVEL_PRIORITY[this._getConfiguredLevel()] || LOG_LEVEL_PRIORITY.info;
    const requested = LOG_LEVEL_PRIORITY[String(level || "").toLowerCase()] || LOG_LEVEL_PRIORITY.info;
    return requested >= current;
  }

  /**
   * ログメッセージを書き込み
   */
  _write(level, message, data = null) {
    if (!this._shouldWrite(level)) return;
    const timestamp = new Date().toISOString();
    let output = `[${timestamp}] [${level}] ${message}`;
    if (data) {
      output += ` | ${JSON.stringify(data)}`;
    }
    output += '\n';
    
    if (this.logFilePath) {
      try {
        fs.appendFileSync(this.logFilePath, output);
      } catch (err) {
        console.error('[AppLogger] Failed to write to log file:', err);
      }
    }
  }

  /**
   * アプリ起動ログ
   * @param {object} metadata - { version, electronVersion }
   */
  logStartup(metadata) {
    this.startTime = Date.now();
    this._write('INFO', 'App startup', {
      version: metadata.version || 'unknown',
      nodeVersion: process.versions.node,
      electronVersion: metadata.electronVersion || process.versions.electron,
      platform: process.platform,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * DB初期化ログ
   * @param {object} stats - { tableCount, indexCount, duration }
   */
  logDbInitialization(stats) {
    this._write('INFO', 'Database initialized', {
      tables: stats.tableCount || 0,
      indexes: stats.indexCount || 0,
      duration: `${stats.duration || 0}ms`,
    });
  }

  /**
   * サービス初期化ログ
   * @param {object} stats - { taskCount, listCount, duration }
   */
  logServiceInitialization(stats) {
    this._write('INFO', 'Services initialized', {
      tasks: stats.taskCount || 0,
      lists: stats.listCount || 0,
      duration: `${stats.duration || 0}ms`,
    });
  }

  /**
   * Viteサーバー起動ログ
   */
  logViteServerStart(port) {
    this._write('INFO', 'Vite dev server started', {
      port: port || 5173,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * 一般情報ログ
   * @param {string} message
   * @param {object|null} data
   */
  logInfo(message, data = null) {
    this._write('INFO', message, data);
  }

  /**
   * エラーログ（スタックトレース付き）
   * @param {string} errorMsg
   * @param {Error|null} error
   */
  logError(errorMsg, error = null) {
    if (!this._shouldWrite('ERROR')) return;
    let output = `[${new Date().toISOString()}] [ERROR] ${errorMsg}`;
    if (error && error.stack) {
      output += `\n${error.stack}`;
    }
    output += '\n';
    
    if (this.logFilePath) {
      try {
        fs.appendFileSync(this.logFilePath, output);
      } catch (err) {
        console.error('[AppLogger] Failed to write to log file:', err);
      }
    }
  }

  /**
   * 警告ログ
   * @param {string} warnMsg
   * @param {object} context
   */
  logWarning(warnMsg, context = null) {
    this._write('WARN', warnMsg, context);
  }

  /**
   * アプリシャットダウンログ
   */
  logShutdown() {
    const duration = this.startTime ? (Date.now() - this.startTime) / 1000 : 0;
    this._write('INFO', 'App shutdown', {
      sessionTime: `${Math.floor(duration)}s`,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * ログファイルをクローズ
   */
  destroy() {
    // 同期書き込みなので、特別なクローズ処理は不要
  }
}

module.exports = new AppLogger();
