// JSON logs (one object per line) and CloudWatch embedded-metric-format metrics (D12). Emails, tokens and
// passwords never reach the logs (NFR6): fields whose names suggest them are replaced before writing.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown>;

export interface Logger {
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

const SENSITIVE_KEY = /email|token|authorization|password|secret|cookie/i;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Copies `value` with sensitive keys replaced and email addresses masked anywhere in strings. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[truncated]';
  if (typeof value === 'string') return value.replace(EMAIL_PATTERN, '[email]');
  if (Array.isArray(value)) return value.map((entry) => redact(entry, depth + 1));
  if (value instanceof Error) return { name: value.name, message: redact(value.message, depth + 1) };
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        SENSITIVE_KEY.test(key) ? '[redacted]' : redact(entry, depth + 1),
      ]),
    );
  }
  return value;
}

export type LogSink = (line: string) => void;

const defaultSink: LogSink = (line) => console.log(line);

export function createLogger(base: LogFields = {}, sink: LogSink = defaultSink): Logger {
  const write = (level: LogLevel, message: string, fields: LogFields = {}) => {
    const entry = redact({ level, message, time: new Date().toISOString(), ...base, ...fields });
    sink(JSON.stringify(entry));
  };
  return {
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
  };
}

export const METRICS_NAMESPACE = 'Jarvel';

export interface Metrics {
  count(name: string, value?: number): void;
  measure(name: string, value: number, unit: 'Milliseconds' | 'None'): void;
}

/** Metrics written as CloudWatch embedded-metric-format log lines, dimensioned by deploy stage. */
export function createMetrics(stage: string, sink: LogSink = defaultSink): Metrics {
  const emit = (name: string, value: number, unit: string) => {
    sink(
      JSON.stringify({
        _aws: {
          Timestamp: Date.now(),
          CloudWatchMetrics: [
            { Namespace: METRICS_NAMESPACE, Dimensions: [['Stage']], Metrics: [{ Name: name, Unit: unit }] },
          ],
        },
        Stage: stage,
        [name]: value,
      }),
    );
  };
  return {
    count: (name, value = 1) => emit(name, value, 'Count'),
    measure: (name, value, unit) => emit(name, value, unit),
  };
}
