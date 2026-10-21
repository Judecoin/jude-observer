export function upgradeVersionStatus(version: string): "upgraded" | "pending" | "unknown" {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return "unknown";
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part)) || parts.every((part) => part === 0)) return "unknown";
  return parts[0] >= 4 ? "upgraded" : "pending";
}

export function forkDuration(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "Awaiting estimate";
  if (seconds < 60) return "Under 1 min";
  const minutes = Math.ceil(seconds / 60);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  return days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes} min`;
}

export function forkUtc(timestamp: string | number | null | undefined) {
  if (timestamp == null) return "Not yet recorded";
  const value = typeof timestamp === "number" ? timestamp * 1000 : Date.parse(timestamp);
  if (!Number.isFinite(value) || value <= 0) return "Not yet recorded";
  return `${new Date(value).toISOString().slice(0, 19).replace("T", " ")} UTC`;
}
