import type { Env, ExecutionContext } from "./runtime-types";
import { deregisteredNodesResponse, serviceNodeResponse } from "./routes/service-node";
import { blockResponse } from "./routes/block";
import { transactionResponse } from "./routes/transaction";
import {
  cachedQuorumLiveResponse,
  cachedNetworkLiveResponse,
  cachedTransactionPoolLiveResponse,
  cachedServiceNodesLiveResponse,
} from "./live-responses";
import { cachedChainResponse } from "./chain-cache";
import { blocksPageResponse, transactionsPageResponse } from "./ledger";
import { DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES, handleImageOptimization } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { explorerBootstrap, rememberBootstrapResponse } from "./bootstrap";
import { runWithExplorerBootstrap } from "./bootstrap-context";

const explorerPages = new Set(["/", "/service-nodes", "/statistics", "/blocks", "/transactions"]);

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const capture = async (kind: "blocks" | "transactions" | "network" | "transactionPool" | "serviceNodes" | "quorums" | "chain", pending: Promise<Response>) => {
      const response = await pending;
      if (response.ok) void rememberBootstrapResponse(kind, url, response, ctx).catch(() => undefined);
      return response;
    };

    if (url.pathname === "/api/blocks" && request.method === "GET") {
      return capture("blocks", blocksPageResponse(url));
    }

    if (url.pathname === "/api/transactions" && request.method === "GET") {
      return capture("transactions", transactionsPageResponse(url));
    }

    if (url.pathname === "/api/deregistered-service-nodes" && request.method === "GET") {
      return deregisteredNodesResponse(url);
    }

    if (url.pathname === "/api/block" && request.method === "GET") {
      return blockResponse(url);
    }

    if (url.pathname === "/api/transaction" && request.method === "GET") {
      return transactionResponse(url);
    }

    if (url.pathname === "/api/service-node" && request.method === "GET") {
      return serviceNodeResponse(url);
    }

    if (url.pathname === "/api/quorums" && request.method === "GET") {
      return capture("quorums", cachedQuorumLiveResponse(url, ctx));
    }

    if (url.pathname === "/api/network" && request.method === "GET") {
      return capture("network", cachedNetworkLiveResponse(url, ctx));
    }

    if (url.pathname === "/api/transaction-pool" && request.method === "GET") {
      return capture("transactionPool", cachedTransactionPoolLiveResponse(url, ctx));
    }

    if (url.pathname === "/api/service-nodes-live" && request.method === "GET") {
      return capture("serviceNodes", cachedServiceNodesLiveResponse(url, ctx));
    }

    if (url.pathname === "/api/chain" && request.method === "GET") {
      return capture("chain", cachedChainResponse(request, url, ctx));
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    if (request.method === "GET" && explorerPages.has(url.pathname)) {
      const initialData = { ...await explorerBootstrap(url, ctx), renderedAt: Date.now() };
      return runWithExplorerBootstrap(initialData, () => handler.fetch(request, env, ctx));
    }
    return handler.fetch(request, env, ctx);
  },
};

export default worker;
