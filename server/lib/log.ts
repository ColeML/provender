type LogFields = Record<string, string | number | boolean>;

/**
 * One JSON line per event, written with `console`.
 *
 * Vercel collects whatever a serverless function writes to the console and expands a JSON line
 * into searchable fields, so a logging library would add a dependency for something the platform
 * already does. Only `warn` and `error` are offered, because routine activity is not worth a line.
 *
 * The field is named `severity` rather than `level` because Vercel's own log view already has a
 * `level` filter, which reads the console method rather than the JSON body. See the Logging
 * section of `coding-standards.md`.
 *
 * Never pass a secret. A log line is readable by anyone who can see the deployment.
 */
function emit(severity: "warn" | "error", event: string, fields: LogFields) {
  // Fields first: `severity` and `event` are what a log search is built on, so a caller's field of
  // the same name must not be able to replace them. A caller's `level` is dropped rather than
  // kept, because a line carrying both invites a log drain to remap the wrong one.
  const { level: _level, ...rest } = fields;
  const line = JSON.stringify({ ...rest, severity, event });

  if (severity === "error") {
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
