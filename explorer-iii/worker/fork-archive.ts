import type { ForkArchiveSnapshot, ForkObservation, ServiceNodesLiveSnapshot, UpgradeReadiness } from "../app/explorer-types";
import type { Env, ExecutionContext } from "./runtime-types";
import { POS_FORK_HEIGHT, POS_TARGET_VERSION } from "./fork";
import { noStoreJson } from "./responses";

interface ArchiveStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  transaction<T>(callback: (storage: ArchiveStorage) => Promise<T>): Promise<T>;
}

function count(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0; }

export function validForkObservation(value: unknown): value is ForkObservation {
  const observation = value as ForkObservation | null;
  const readiness = observation?.readiness;
  return observation != null && count(observation.height) && observation.height < POS_FORK_HEIGHT
    && typeof observation.observedAt === "string" && Number.isFinite(Date.parse(observation.observedAt))
    && Date.parse(observation.observedAt) <= Date.now() + 60_000
    && typeof observation.source === "string" && observation.source.length > 0 && observation.source.length <= 256
    && readiness != null && readiness.targetVersion === POS_TARGET_VERSION && readiness.scope === "registered-service-nodes"
    && count(readiness.eligibleTotal) && readiness.eligibleTotal > 0
    && count(readiness.upgraded) && count(readiness.pending) && count(readiness.unknown)
    && readiness.unknown < readiness.eligibleTotal
    && readiness.upgraded + readiness.pending + readiness.unknown === readiness.eligibleTotal
    && readiness.percentage === Math.round(readiness.upgraded / readiness.eligibleTotal * 10_000) / 100
    && Array.isArray(readiness.versions) && readiness.versions.every((entry) => (
      typeof entry.version === "string" && /^\d+\.\d+\.\d+$/.test(entry.version) && count(entry.count) && entry.count > 0
    )) && readiness.versions.reduce((sum, entry) => sum + entry.count, 0) === readiness.eligibleTotal - readiness.unknown;
}

function archiveSnapshot(preFork: ForkObservation | null): ForkArchiveSnapshot {
  return { available: true, preFork, exactClosingSnapshot: preFork?.height === POS_FORK_HEIGHT - 1 };
}

function preferObservation(current: ForkObservation | null, next: ForkObservation): ForkObservation {
  if (!current) return next;
  if (current.height !== next.height) return current.height > next.height ? current : next;
  if (next.readiness.unknown > current.readiness.unknown) return current;
  return Date.parse(next.observedAt) > Date.parse(current.observedAt) ? next : current;
}

export class ForkArchive {
  private readonly storage: ArchiveStorage;

  constructor(state: { storage: ArchiveStorage }) { this.storage = state.storage; }

  async fetch(request: Request): Promise<Response> {
    if (request.method === "POST") {
      const body: unknown = await request.json().catch(() => null);
      if (!validForkObservation(body)) return noStoreJson({ error: "Invalid pre-fork observation" }, 400);
      const saved = await this.storage.transaction(async (storage) => {
        const stored = await storage.get<ForkObservation>("pre-fork");
        const current = validForkObservation(stored) ? stored : null;
        const next = preferObservation(current, body);
        if (next !== current) await storage.put("pre-fork", next);
        return next;
      });
      return noStoreJson(archiveSnapshot(saved));
    }
    if (request.method !== "GET") return noStoreJson({ error: "Method not allowed" }, 405);
    const stored = await this.storage.get<ForkObservation>("pre-fork");
    return noStoreJson(archiveSnapshot(validForkObservation(stored) ? stored : null));
  }
}

const unavailable: ForkArchiveSnapshot = { available: false, preFork: null, exactClosingSnapshot: false };

async function storedForkArchive(env: Env, observation?: ForkObservation): Promise<ForkArchiveSnapshot> {
  if (!env.FORK_ARCHIVE) return unavailable;
  const stub = env.FORK_ARCHIVE.get(env.FORK_ARCHIVE.idFromName(`judecoin-mainnet-pos-${POS_FORK_HEIGHT}`));
  const response = await stub.fetch(new Request("https://fork-archive.internal/", observation
    ? { method: "POST", body: JSON.stringify(observation), headers: { "content-type": "application/json" } } : undefined));
  if (!response.ok) return unavailable;
  const result = await response.json() as ForkArchiveSnapshot;
  if (result?.available !== true || (result.preFork != null && !validForkObservation(result.preFork))) return unavailable;
  return { ...result, exactClosingSnapshot: result.preFork?.height === POS_FORK_HEIGHT - 1 };
}

async function boundedForkArchive(env: Env, ctx: ExecutionContext, observation?: ForkObservation): Promise<ForkArchiveSnapshot> {
  const pending = storedForkArchive(env, observation).catch(() => unavailable);
  ctx.waitUntil(pending);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([pending, new Promise<ForkArchiveSnapshot>((resolve) => { timer = setTimeout(() => resolve(unavailable), 1_200); })]);
  } finally { clearTimeout(timer); }
}

export async function attachForkArchive(response: Response, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (!response.ok) return response;
  try {
    const snapshot = await response.clone().json() as ServiceNodesLiveSnapshot;
    const readiness: UpgradeReadiness | undefined = snapshot.serviceNodes?.upgradeReadiness;
    const observation = { height: snapshot.height, observedAt: snapshot.fetchedAt, source: "Judecoin service-node RPC", readiness };
    const forkArchive = await boundedForkArchive(env, ctx, validForkObservation(observation) ? observation : undefined);
    return noStoreJson({ ...snapshot, serviceNodes: { ...snapshot.serviceNodes, forkArchive } });
  } catch { return response; }
}

export async function forkArchiveResponse(env: Env, ctx: ExecutionContext): Promise<Response> {
  return noStoreJson(await boundedForkArchive(env, ctx));
}
