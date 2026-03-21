type LogLevel = "INFO" | "ERROR";

function isDebugEnabled(): boolean {
  if (process.env.DEBUG_LOG_ENABLED === "true") {
    return true;
  }
  return process.env.NODE_ENV !== "production";
}

function toLogLine(level: LogLevel, scope: string, message: string, details?: Record<string, unknown>): string {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    scope,
    message,
    ...(details ? { details } : {})
  };
  return JSON.stringify(payload);
}

export function logInfo(scope: string, message: string, details?: Record<string, unknown>): void {
  if (!isDebugEnabled()) {
    return;
  }
  console.info(toLogLine("INFO", scope, message, details));
}

export function logError(scope: string, message: string, error: unknown, details?: Record<string, unknown>): void {
  const normalizedError =
    error instanceof Error
      ? {
          name: error.name,
          message: error.message
        }
      : { message: String(error) };

  console.error(
    toLogLine("ERROR", scope, message, {
      ...details,
      error: normalizedError
    })
  );
}
