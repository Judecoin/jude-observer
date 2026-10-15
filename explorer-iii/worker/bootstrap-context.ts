import { AsyncLocalStorage } from "node:async_hooks";
import type { ExplorerBootstrap } from "../app/explorer-types";

// Vinext's Worker and server-component bundles can instantiate this module
// separately. One store per isolate preserves the same request-local context.
const bootstrapContextKey = Symbol.for("judecoin.explorer.bootstrap.v1");
const contextGlobal = globalThis as unknown as Record<symbol, AsyncLocalStorage<ExplorerBootstrap> | undefined>;
const bootstrapContext = contextGlobal[bootstrapContextKey] ??= new AsyncLocalStorage<ExplorerBootstrap>();

export function runWithExplorerBootstrap<T>(data: ExplorerBootstrap, render: () => T): T {
  return bootstrapContext.run(data, render);
}

export function readExplorerBootstrap(): ExplorerBootstrap | undefined {
  return bootstrapContext.getStore();
}
