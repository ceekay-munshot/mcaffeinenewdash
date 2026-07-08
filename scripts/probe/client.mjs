// Thin Probe42 API client (Comprehensive Details flow).
// Docs: apiportal.probe42.in — paths per the "API Workflow for Comprehensive
// Details" sheet. Auth + base URL come from env so no secret ever lands in code:
//   PROBE42_API_KEY   (required for live calls)
//   PROBE42_BASE_URL  (default https://api.probe42.in)
//   PROBE42_API_VERSION (default 1.3)
//   PROBE42_ENV       "sandbox" (default) | "prod" -> selects the path segment
//
// Every live call costs credits on the client's account, so callers gate this
// behind an explicit --live flag.

const BASE = process.env.PROBE42_BASE_URL || "https://api.probe42.in";
const VERSION = process.env.PROBE42_API_VERSION || "1.3";
const isProd = (process.env.PROBE42_ENV || "sandbox") === "prod";
// Path prefix is overridable: the 2025-doc sandbox prefix (probe_pro_sandbox) was
// deprecated by Probe42, so the current one must come from their POC and gets set
// via PROBE42_PATH_PREFIX — no code change needed.
const SEG = process.env.PROBE42_PATH_PREFIX || (isProd ? "probe_pro" : "probe_pro_sandbox");
const REPORT_SEG = process.env.PROBE42_REPORT_PREFIX || (isProd ? "probe_reports" : "probe_reports_sandbox");

function headers() {
  const key = process.env.PROBE42_API_KEY;
  if (!key) throw new Error("PROBE42_API_KEY not set — cannot make live Probe42 calls.");
  // Probe42 accepts the key + version as headers. Names are overridable in case
  // the account uses a different scheme (confirmed against the portal's Try console).
  return {
    [process.env.PROBE42_KEY_HEADER || "x-api-key"]: key,
    [process.env.PROBE42_VERSION_HEADER || "api-version"]: VERSION,
    accept: "application/json",
  };
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { headers: headers() });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { ok: res.ok, status: res.status, body };
}

async function post(path) {
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers: headers() });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { ok: res.ok, status: res.status, body };
}

export const probe = {
  base: BASE,
  env: SEG,
  dataStatus: (cin) => get(`/${SEG}/companies/${encodeURIComponent(cin)}/datastatus`),
  comprehensive: (cin) => get(`/${SEG}/companies/${encodeURIComponent(cin)}/comprehensive-details`),
  requestUpdate: (cin) => post(`/${SEG}/companies/${encodeURIComponent(cin)}/update`),
  updateStatus: (cin) => get(`/${SEG}/companies/${encodeURIComponent(cin)}/get-update-status`),
  reportPdf: (cin) => get(`/${REPORT_SEG}/companies/${encodeURIComponent(cin)}/reports`),
};
