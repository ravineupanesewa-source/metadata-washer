const UNITS = ["B", "KB", "MB", "GB"] as const;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(value < 10 ? 1 : 0)} ${UNITS[unit]}`;
}

export function formatDimensions(width: number | null, height: number | null): string {
  return width && height ? `${width} × ${height}` : "—";
}

export function formatSizeDelta(before: number, after: number): string {
  const diff = after - before;
  if (diff === 0) return "no change";
  return `${diff < 0 ? "−" : "+"}${formatBytes(Math.abs(diff))}`;
}
