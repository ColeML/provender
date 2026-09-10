type LogFields = Record<string, string | number | boolean>;

/**
 * One JSON line per event, written with `console`.
 *
 * Vercel collects whatever a serverless function writes to the console and expands a JSON line
 * into searchable fields, so a logging library would add a dependency for something the platform
 * already does. Only `warn` and `error` are offered: anything quieter is hidden from the runtime
 * log view by default, which makes it useless for the failures worth recording.
 *
 * Never pass a secret. A log line is readable by anyone who can see the deployment.
 */
function emit(level: "warn" | "error", event: string, fields: LogFields) {
  const line = JSON.stringify({ level, event, ...fields });

  if (level === "error") {
    console.error(line);
  } else {
    console.warn(line);
  }
}

export function logWarn(event: string, fields: LogFields = {}) {
  emit("warn", event, fields);
}

export function logError(event: string, fields: LogFields = {}) {
  emit("error", event, fields);
}
