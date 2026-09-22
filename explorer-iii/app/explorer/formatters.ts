

const compactNumberFormatter = new Intl.NumberFormat("en-US");

const judeNumberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });

const atomicJudeNumberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 9 });

export function isBlockHeightLabel(label: string) {
  return /\bHEIGHT\b|\bAT BLOCK\b|\bREWARD BLOCK\b|\bDECOMMISSION BLOCK\b|\bIP CHANGE BLOCK\b|\bREGISTERED BLOCK\b/.test(label);
}

export function compact(value: number) {
  return compactNumberFormatter.format(value);
}

export function inOut(inputs?: number, outputs?: number) {
  if (inputs == null && outputs == null) return "N/A";
  return `${inputs ?? "N/A"}/${outputs ?? "N/A"}`;
}

export function age(timestamp: number) {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - timestamp));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

export function bytes(value: number | null) {
  return value == null ? "SHIELDED" : value < 1024 ? `${value} B` : `${(value / 1024).toFixed(1)} kB`;
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
  const timestamp = (latestBlockTimestamp + remainingBlocks * targetSeconds) * 1_000;
  return `${new Date(timestamp).toLocaleString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })} UTC`;
}
