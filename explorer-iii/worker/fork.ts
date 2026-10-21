import type { ForkSnapshot, UpgradeReadiness } from "../app/explorer-types";

export const POS_FORK_HEIGHT = 882_300;
export const POS_TARGET_VERSION = "4.0.0";
export const POS_TARGET_PROTOCOL = 17;

export function normalizeNodeVersion(value: unknown): string | null {
  if (!Array.isArray(value) || value.length < 3 || value.length > 4
    || !value.every((part) => Number.isSafeInteger(part) && part >= 0)
    || value.every((part) => part === 0)) return null;
  return value.slice(0, 3).join(".");
}

export function buildUpgradeReadiness(versions: unknown[]): UpgradeReadiness {
  let upgraded = 0;
  let unknown = 0;
  const distribution = new Map<string, number>();
  for (const raw of versions) {
    const version = normalizeNodeVersion(raw);
    if (version == null) { unknown += 1; continue; }
    distribution.set(version, (distribution.get(version) ?? 0) + 1);
    const [major] = version.split(".").map(Number);
    if (major >= 4) upgraded += 1;
  }
  return {
    targetVersion: POS_TARGET_VERSION,
    eligibleTotal: versions.length,
    upgraded,
    pending: versions.length - upgraded - unknown,
    unknown,
    percentage: versions.length ? Math.round(upgraded / versions.length * 10_000) / 100 : null,
    versions: [...distribution].map(([version, count]) => ({ version, count }))
      .sort((a, b) => b.count - a.count || a.version.localeCompare(b.version)),
    scope: "registered-service-nodes",
  };
}

export function buildForkSnapshot(height: number, currentProtocol: number, targetSeconds: number, observedAt: string,
  activationBlock: ForkSnapshot["activationBlock"] = null): ForkSnapshot {
  const verifiedActivationBlock = activationBlock?.height === POS_FORK_HEIGHT
    && /^[a-f0-9]{64}$/i.test(activationBlock.hash) && Number.isSafeInteger(activationBlock.timestamp)
    && activationBlock.timestamp > 0 ? activationBlock : null;
  const blocksRemaining = Math.max(0, POS_FORK_HEIGHT - height);
  const observedTime = Date.parse(observedAt);
  const estimate = Number.isFinite(observedTime) && Number.isFinite(targetSeconds) && targetSeconds > 0
    ? observedTime + blocksRemaining * targetSeconds * 1_000 : NaN;
  return {
    activationHeight: POS_FORK_HEIGHT,
    targetProtocol: POS_TARGET_PROTOCOL,
    targetVersion: POS_TARGET_VERSION,
    currentProtocol,
    phase: height < POS_FORK_HEIGHT ? "scheduled"
      : verifiedActivationBlock?.protocol === POS_TARGET_PROTOCOL && currentProtocol >= POS_TARGET_PROTOCOL ? "activated" : "unverified",
    blocksRemaining,
    blocksSinceActivation: Math.max(0, height - POS_FORK_HEIGHT),
    estimatedActivationAt: blocksRemaining > 0 && Number.isFinite(estimate) && estimate <= 8.64e15 ? new Date(estimate).toISOString() : null,
    observedAt,
    activationBlock: verifiedActivationBlock,
  };
}
