// API base URL — auto-detected from current page URL
//
// The UI is served by the PAAW server itself, so the page URL's port
// IS the API port. No need to hardcode or configure separately.
//
// Override only if API runs on a different host/port than the UI.

const EXPLICIT_PORT = import.meta.env.VITE_PAAW_PORT;

const API_BASE = typeof window !== "undefined"
  ? (EXPLICIT_PORT
      ? `${window.location.protocol}//${window.location.hostname}:${EXPLICIT_PORT}`
      : `${window.location.protocol}//${window.location.host}`) // use page's own host:port
  : `http://127.0.0.1:4097`; // SSR fallback (unused)

export default API_BASE;
