export const DEFAULT_DURATION_MS = 60 * 60 * 1000; // 1 hour
export const WARNING_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

const DURATION_REGEX = /^(?:(\d+)h)?(?:(\d+)m)?$/;

export function parseDuration(input: string): number {
  const trimmed = input.trim();

  // Bare number → treat as minutes
  if (/^\d+$/.test(trimmed)) {
    const minutes = parseInt(trimmed, 10);
    if (minutes <= 0) throw new Error('Duration must be positive.');
    return minutes * 60 * 1000;
  }

  const match = trimmed.match(DURATION_REGEX);
  if (!match || (!match[1] && !match[2])) {
    throw new Error('Invalid duration format. Use: `30m`, `2h`, `1h30m`, or a number (minutes).');
  }

  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const ms = (hours * 60 + minutes) * 60 * 1000;

  if (ms <= 0) throw new Error('Duration must be positive.');
  return ms;
}

export function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

export function formatSlackTimestamp(isoString: string): string {
  const epoch = Math.floor(new Date(isoString + 'Z').getTime() / 1000);
  return `<!date^${epoch}^{date_short_pretty} at {time}|${isoString}>`;
}

export function formatSlackTime(isoString: string): string {
  const epoch = Math.floor(new Date(isoString + 'Z').getTime() / 1000);
  return `<!date^${epoch}^{time}|${isoString}>`;
}

export function nowPlusDuration(durationMs: number): string {
  return new Date(Date.now() + durationMs).toISOString().replace(/\.\d{3}Z$/, '');
}

export function isExpired(expiresAt: string): boolean {
  return new Date(expiresAt + 'Z').getTime() <= Date.now();
}

export function msUntil(isoString: string): number {
  return new Date(isoString + 'Z').getTime() - Date.now();
}
