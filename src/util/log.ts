// Lightweight logger with component tags and structured key=value output.
// No external dependencies — uses only Node.js built-in APIs.

function resolveLogLevel(): number {
  const value = process.env.MCPUPPET_LOG_LEVEL;
  if (!value) {
    return 3;
  }

  const numeric = Number(value);
  if (!Number.isNaN(numeric)) {
    return numeric;
  }

  const namedLevels: Record<string, number> = {
    silent: 0,
    fatal: 0,
    error: 1,
    warn: 2,
    info: 3,
    debug: 4,
    trace: 5,
    verbose: 4,
  };

  return namedLevels[value.toLowerCase()] ?? 3;
}

const configuredLevel = resolveLogLevel();

// ANSI color helpers.
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const GRAY = "\x1b[90m";

interface LevelConfig {
  label: string;
  color: string;
  level: number;
  stream: NodeJS.WriteStream;
}

const levels: Record<string, LevelConfig> = {
  fatal: { label: "FATAL", color: RED, level: 0, stream: process.stderr },
  error: { label: "ERROR", color: RED, level: 1, stream: process.stderr },
  warn: { label: "WARN ", color: YELLOW, level: 2, stream: process.stderr },
  info: { label: "INFO ", color: GREEN, level: 3, stream: process.stdout },
  debug: { label: "DEBUG", color: GRAY, level: 4, stream: process.stdout },
  trace: { label: "TRACE", color: GRAY, level: 5, stream: process.stdout },
};

/** Format a value for display in key=value pairs. */
function formatValue(value: unknown): string {
  if (typeof value === "string") {
    if (value.length === 0 || value.includes(" ")) {
      return `"${value}"`;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return `[${value.map(formatValue).join(",")}]`;
  }
  return String(value);
}

/** Format structured fields as key=value pairs with gray coloring. */
function formatFields(obj: Record<string, unknown>): string {
  return Object.entries(obj)
    .map(([key, value]) => `${GRAY}${key}=${RESET}${formatValue(value)}`)
    .join(" ");
}

function formatTime(date: Date): string {
  const h = date.getHours().toString().padStart(2, "0");
  const m = date.getMinutes().toString().padStart(2, "0");
  const s = date.getSeconds().toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

// Track the widest tag seen so far to pad narrower tags for aligned output.
// Updated at logger creation time, so all tags are registered before the first log line.
let maxTagWidth = 0;

function write(
  levelName: string,
  tag: string,
  args: unknown[],
): void {
  const cfg = levels[levelName];
  if (!cfg || cfg.level > configuredLevel) {
    return;
  }

  // Parse args: first arg may be structured fields, rest are message parts.
  let fields: Record<string, unknown> | null = null;
  let messageParts: unknown[];
  if (
    args.length > 0 &&
    typeof args[0] === "object" &&
    args[0] !== null &&
    !Array.isArray(args[0]) &&
    !(args[0] instanceof Error)
  ) {
    fields = args[0] as Record<string, unknown>;
    messageParts = args.slice(1);
  } else {
    messageParts = args;
  }

  const message = messageParts.map(String).join(" ");
  const time = `${GRAY}${formatTime(new Date())}${RESET}`;
  const level = `${cfg.color}${cfg.label}${RESET}`;

  const paddedTag = tag.padEnd(maxTagWidth);
  const tagStr = `${CYAN}[${paddedTag}]${RESET}`;

  const parts = [time, level, tagStr];

  if (message) {
    parts.push(`${BOLD}${message}${RESET}`);
  }

  if (fields && Object.keys(fields).length > 0) {
    parts.push(formatFields(fields));
  }

  cfg.stream.write(parts.join(" ") + "\n");
}

export interface Logger {
  fatal: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  trace: (...args: unknown[]) => void;
}

/** Create a tagged logger for a specific component. */
export function createLogger(tag: string): Logger {
  if (tag.length > maxTagWidth) {
    maxTagWidth = tag.length;
  }
  return {
    fatal: (...args: unknown[]) => write("fatal", tag, args),
    error: (...args: unknown[]) => write("error", tag, args),
    warn: (...args: unknown[]) => write("warn", tag, args),
    info: (...args: unknown[]) => write("info", tag, args),
    debug: (...args: unknown[]) => write("debug", tag, args),
    trace: (...args: unknown[]) => write("trace", tag, args),
  };
}
