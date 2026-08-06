/** Runtime config from Vite env (V2_CONTRACT §6). No secrets (SEC-002). */

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:4000/api/v2';
const WS_BASE = import.meta.env.VITE_WS_BASE ?? 'ws://localhost:4000';

export const config = {
  apiBase: API_BASE,
  wsBase: WS_BASE,
} as const;
