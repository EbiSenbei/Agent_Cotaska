const fs = require("fs");
const path = require("path");
const os = require("os");

class EarlyStartupLogger {
  constructor() {
    this.logFilePath = null;
    this.handlersInstalled = false;
    this.secondaryLogger = null;
    this._openLogFile();
  }

  _openLogFile() {
    const today = new Date().toISOString().slice(0, 10);
    const candidates = [
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Cotaska", "logs") : null,
      process.env.APPDATA ? path.join(process.env.APPDATA, "Cotaska", "logs") : null,
      path.join(os.tmpdir(), "Cotaska", "logs"),
      path.join(process.cwd(), "../logs"),
      path.join(process.cwd(), "logs"),
      path.join(path.dirname(process.execPath || process.cwd()), "logs"),
    ].filter(Boolean);

    for (const logDir of candidates) {
      try {
        fs.mkdirSync(logDir, { recursive: true });
        this.logFilePath = path.join(logDir, `app-${today}.log`);
        return;
      } catch (_err) {
        // Try the next location. This logger must never break startup.
      }
    }
  }

  setSecondaryLogger(logger) {
    this.secondaryLogger = logger;
  }

  configureLogDir(logDir) {
    try {
      fs.mkdirSync(logDir, { recursive: true });
      this.logFilePath = path.join(logDir, `app-${new Date().toISOString().slice(0, 10)}.log`);
    } catch (_err) { /* startup logging remains best effort */ }
  }

  _serializeError(error) {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: error.code,
        requireStack: error.requireStack,
      };
    }
    return {
      name: typeof error,
      message: String(error),
    };
  }

  _write(level, message, payload = null) {
    const line = `[${new Date().toISOString()}] [${level}] ${message}`;
    const body = payload ? `${line}\n${JSON.stringify(payload, null, 2)}\n` : `${line}\n`;
    if (!this.logFilePath) return;
    try {
      fs.appendFileSync(this.logFilePath, body, "utf8");
    } catch (_err) {
      // Swallow logging failures; this is best-effort crash evidence.
    }
  }

  logError(message, error = null, context = {}) {
    const payload = {
      error: error ? this._serializeError(error) : null,
      context,
      process: {
        cwd: process.cwd(),
        execPath: process.execPath,
        argv: process.argv,
        platform: process.platform,
        versions: process.versions,
      },
    };
    this._write("ERROR", message, payload);

    if (this.secondaryLogger && typeof this.secondaryLogger.logError === "function") {
      try {
        this.secondaryLogger.logError(message, error instanceof Error ? error : new Error(String(error)));
      } catch (_err) {
        // Avoid recursive logging failures.
      }
    }
  }

  logInfo(message, context = {}) {
    this._write("INFO", message, { context });
  }

  logWarning(message, context = {}) {
    this._write("WARN", message, { context });
  }

  installProcessErrorHandlers() {
    if (this.handlersInstalled) return;
    this.handlersInstalled = true;

    process.on("uncaughtException", (err) => {
      this.logError("uncaughtException in main process", err);
    });

    process.on("unhandledRejection", (reason) => {
      const err = reason instanceof Error ? reason : new Error(String(reason));
      this.logError("unhandledRejection in main process", err);
    });

    process.on("warning", (warning) => {
      this.logWarning("process warning in main process", this._serializeError(warning));
    });
  }
}

module.exports = new EarlyStartupLogger();
