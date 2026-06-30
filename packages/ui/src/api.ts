// API base URL — port configurable via Vite env (VITE_PAAW_PORT)
// Default: 4097
const PAAW_PORT = import.meta.env.VITE_PAAW_PORT || "4097";

// Auto-detect API base from current page URL
// Works for localhost, LAN IP, or any host accessing PAAW
const API_BASE = typeof window !== "undefined"
  ? `${window.location.protocol}//${window.location.hostname}:${PAAW_PORT}`
  : `http://127.0.0.1:${PAAW_PORT}`;

export default API_BASE;
