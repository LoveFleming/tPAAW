// Auto-detect API base from current page URL
// Works for localhost, LAN IP, or any host accessing PAAW
const API_BASE = typeof window !== "undefined"
  ? `${window.location.protocol}//${window.location.hostname}:4097`
  : "http://127.0.0.1:4097";

export default API_BASE;
