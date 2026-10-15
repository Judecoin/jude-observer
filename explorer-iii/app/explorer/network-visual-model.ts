import type { ChainSnapshot } from "../explorer-types";

export type BlockInterval = {
  height: number;
  previousHeight: number;
  timestamp: number;
  elapsedSeconds: number;
};

/** Only adjacent, unambiguous block heights can establish a block interval. */
export function getBlockIntervals(blocks: Pick<ChainSnapshot["blocks"][number], "height" | "timestamp">[]): BlockInterval[] {
  const heightCounts = new Map<number, number>();
  for (const block of blocks) heightCounts.set(block.height, (heightCounts.get(block.height) ?? 0) + 1);
  const ordered = blocks.filter((block) => Number.isSafeInteger(block.height) && block.height >= 0
    && Number.isSafeInteger(block.timestamp) && block.timestamp > 0
    && heightCounts.get(block.height) === 1).sort((left, right) => left.height - right.height);
  const intervals: BlockInterval[] = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    const elapsedSeconds = current.timestamp - previous.timestamp;
    if (current.height !== previous.height + 1 || elapsedSeconds < 0) continue;
    intervals.push({ height: current.height, previousHeight: previous.height, timestamp: current.timestamp, elapsedSeconds });
  }
  return intervals;
}

/** Percent coordinates keep the rendering independent of viewport size. */
export function getIntervalPlot(intervals: BlockInterval[], targetSeconds: number | null | undefined) {
  const valid = intervals.filter((interval) => Number.isFinite(interval.elapsedSeconds) && interval.elapsedSeconds >= 0);
  const target = typeof targetSeconds === "number" && Number.isFinite(targetSeconds) && targetSeconds > 0 ? targetSeconds : null;
  const maximumSeconds = Math.max(1, target ?? 0, ...valid.map((interval) => interval.elapsedSeconds));
  const step = valid.length ? 100 / valid.length : 100;
  return {
    maximumSeconds,
    targetSeconds: target,
    targetY: target === null ? null : 100 - (target / maximumSeconds) * 100,
    meanSeconds: valid.length ? valid.reduce((sum, interval) => sum + interval.elapsedSeconds, 0) / valid.length : null,
    bars: valid.map((interval, index) => ({
      ...interval,
      x: index * step + step * 0.15,
      width: step * 0.7,
      y: 100 - (interval.elapsedSeconds / maximumSeconds) * 100,
      barHeight: (interval.elapsedSeconds / maximumSeconds) * 100,
    })),
  };
}

export type OrbitMember = {
  publicKey: string;
  index: number;
  role: "validator" | "worker";
  x: number;
  y: number;
};

/** The ellipses express sampled quorum membership, never geography or peer links. */
export function quorumMemberPositions(keys: string[], role: OrbitMember["role"]): OrbitMember[] {
  const radiusX = role === "validator" ? 111 : 178;
  const radiusY = role === "validator" ? 60 : 98;
  return keys.map((publicKey, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / keys.length;
    return { publicKey, index, role, x: 220 + Math.cos(angle) * radiusX, y: 135 + Math.sin(angle) * radiusY };
  });
}
