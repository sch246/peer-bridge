// Health check endpoint.
// GET /health → { peer_count: N, federation_size: 0, uptime_seconds: N }
//
// Per DESIGN.md §6.1: "健康检查：GET /health 返回 peer 数量、federation 状态。"

import type { FastifyInstance } from 'fastify';
import type { ServerState } from './state.js';

export function registerHealthRoute(app: FastifyInstance, state: ServerState): void {
  app.get('/health', async (_request, _reply) => {
    const uptime = Math.floor((Date.now() - state.started_at) / 1000);
    return {
      peer_count: state.peerCount(),
      federation_size: state.federationSize(),
      uptime_seconds: uptime,
    };
  });
}
