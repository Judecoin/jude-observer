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
import { DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES, handleImageOptimization } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

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
      return cachedQuorumLiveResponse(url, ctx);
    }

    if (url.pathname === "/api/network" && request.method === "GET") {
      return cachedNetworkLiveResponse(url, ctx);
    }

    if (url.pathname === "/api/transaction-pool" && request.method === "GET") {
      return cachedTransactionPoolLiveResponse(url, ctx);
    }

    if (url.pathname === "/api/service-nodes-live" && request.method === "GET") {
      return cachedServiceNodesLiveResponse(url, ctx);
    }

    if (url.pathname === "/api/chain" && request.method === "GET") {
      return cachedChainResponse(request, url, ctx);
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

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
