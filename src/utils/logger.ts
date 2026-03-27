/**
 * Structured logger that respects ADO_LOG_LEVEL.
 * Logs to stderr to avoid interfering with MCP stdio transport.
 */

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type LogLevel = keyof typeof LOG_LEVELS;

function getConfiguredLevel(): LogLevel {
  const env = process.env.ADO_LOG_LEVEL?.toLowerCase();
  if (env && env in LOG_LEVELS) return env as LogLevel;
  return "info";
}

const configuredLevel = getConfiguredLevel();

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[configuredLevel];
}

function formatMessage(level: LogLevel, message: string, data?: Record<string, unknown>): string {
  const timestamp = new Date().toISOString();
  const base = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  if (data) {
    return `${base} ${JSON.stringify(data)}`;
  }
  return base;
}

export const logger = {
  debug(message: string, data?: Record<string, unknown>) {
    if (shouldLog("debug")) process.stderr.write(formatMessage("debug", message, data) + "\n");
  },
  info(message: string, data?: Record<string, unknown>) {
    if (shouldLog("info")) process.stderr.write(formatMessage("info", message, data) + "\n");
  },
  warn(message: string, data?: Record<string, unknown>) {
    if (shouldLog("warn")) process.stderr.write(formatMessage("warn", message, data) + "\n");
  },
  error(message: string, data?: Record<string, unknown>) {
    if (shouldLog("error")) process.stderr.write(formatMessage("error", message, data) + "\n");
  },
};
