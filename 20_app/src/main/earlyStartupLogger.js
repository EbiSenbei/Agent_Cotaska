const fs = require("fs");
const path = require("path");

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
      path.join(process.cwd(), "../logs"),
      path.join(process.cwd(), "logs"),
      path.join(path.dirname(process.execPath || process.cwd()), "logs"),
    ];

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
