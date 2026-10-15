

const compactNumberFormatter = new Intl.NumberFormat("en-US");

const judeNumberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });

const atomicJudeNumberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 9 });

const feeJudeNumberFormatter = new Intl.NumberFormat("en-US", { minimumFractionDigits: 8, maximumFractionDigits: 8 });

export function isBlockHeightLabel(label: string) {
  return /\bHEIGHT\b|\bAT BLOCK\b|\bREWARD BLOCK\b|\bDECOMMISSION BLOCK\b|\bIP CHANGE BLOCK\b|\bREGISTERED BLOCK\b/.test(label);
}

export function compact(value: number) {
  return compactNumberFormatter.format(value);
}

export function inOut(inputs?: number | null, outputs?: number | null) {
  if (inputs == null && outputs == null) return "N/A";
  return `${inputs ?? "N/A"}/${outputs ?? "N/A"}`;
}

export function age(timestamp: number, nowMs = Date.now()) {
  const seconds = Math.max(0, Math.floor(nowMs / 1000 - timestamp));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

export function utcTimestamp(seconds: number) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "Not reported";
  const date = new Date(seconds * 1_000);
  if (!Number.isFinite(date.getTime())) return "Not reported";
  const parts = date.toISOString().match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})\.\d{3}Z$/);
  return parts ? `${parts[1]} ${parts[2]} UTC` : "Not reported";
}

export function bytes(value: number | null) {
  return value == null ? "Not reported" : value < 1024 ? `${value} B` : `${(value / 1024).toFixed(1)} KiB`;
}

export function difficulty(value: number) {
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)} G`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)} M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(2)} K`;
  return compact(value);
}

export function hashPreview(value: string) {
  return value.length > 32 ? `${value.slice(0, 20)}...${value.slice(-8)}` : value;
}

export function jude(value: number) {
  return judeNumberFormatter.format(value / 1_000_000_000);
}

export function atomicJude(value: number) {
  return atomicJudeNumberFormatter.format(value / 1_000_000_000);
}

export function feeJude(value: number) {
  return feeJudeNumberFormatter.format(value / 1_000_000_000);
}

export function estimatedBlockWait(blocks: number, targetSeconds: number) {
  if (blocks <= 0) return "Unlock height reached";
  const totalMinutes = Math.max(1, Math.round((blocks * targetSeconds) / 60));
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  if (days) return `${compact(days)} d ${hours} h`;
  if (hours) return `${hours} h ${minutes} min`;
  return `${minutes} min`;
}

export function estimatedBlockDate(currentHeight: number, unlockHeight: number, targetSeconds: number, latestBlockTimestamp: number) {
  const remainingBlocks = Math.max(0, unlockHeight - currentHeight);
  const timestamp = latestBlockTimestamp + remainingBlocks * targetSeconds;
  return utcTimestamp(timestamp);
}

export function serviceNodeUnlockEstimate(unlockHeight: number, network: {
  height: number;
  targetSeconds: number;
  targetVerified?: boolean;
  latestBlockTimestamp: number;
  synced?: boolean;
} | null, observedHeight = network?.height ?? 0) {
  if (!network || network.targetVerified !== true || network.synced !== true
    || !Number.isSafeInteger(unlockHeight) || unlockHeight <= 0
    || !Number.isSafeInteger(network.height) || network.height <= 0
    || !Number.isSafeInteger(observedHeight) || observedHeight <= 0
    || !Number.isFinite(network.targetSeconds) || network.targetSeconds <= 0
    || !Number.isSafeInteger(network.latestBlockTimestamp) || network.latestBlockTimestamp <= 0) return null;
  const currentHeight = Math.max(network.height, observedHeight);
  const remainingBlocks = Math.max(0, unlockHeight - currentHeight);
  if (!remainingBlocks) return { currentHeight, remainingBlocks, wait: "Unlock height reached", date: null };
  // Use the height belonging to this timestamp; Service Node snapshots may be newer.
  const timestamp = network.latestBlockTimestamp + (unlockHeight - network.height) * network.targetSeconds;
  if (!Number.isFinite(timestamp) || timestamp * 1_000 > 8.64e15) return null;
  return {
    currentHeight,
    remainingBlocks,
    wait: estimatedBlockWait(remainingBlocks, network.targetSeconds),
    date: estimatedBlockDate(network.height, unlockHeight, network.targetSeconds, network.latestBlockTimestamp),
  };
}
