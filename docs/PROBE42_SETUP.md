# Probe42 setup (VPN + API key)

Probe42 gives the **live MCA financials** (revenue, EBITDA %, RoCE, etc.) for the
**private** supplier companies we can't get for free. Its **production** API only
answers requests coming from a **whitelisted IP** (the IP you took from Tech). A
GitHub Action's IP is random, so every call must go out **through your VPN** so it
arrives from that whitelisted IP.

> ⚠️ **Credits are limited (~100).** Nothing here calls Probe42 until you decide to.
> The verification step below spends **0 credits**.

## Step 1 — Add 4 secrets

GitHub → repo **Settings → Secrets and variables → Actions → New repository secret**.
Add these four (names must match exactly):

| Secret                 | What to paste                                              |
| ---------------------- | ---------------------------------------------------------- |
| `PROBE42_API_KEY_PROD` | your **production** Probe42 API key (preferred name)       |
| `VPN_CONFIG`           | the **entire contents** of the `.ovpn` file                |
| `VPN_USERNAME`         | the VPN login name                                         |
| `VPN_PASSWORD`         | the VPN password                                           |

Key-name note: the workflows read `PROBE42_API_KEY_PROD` first and fall back to
the older `PROBE42_API_KEY` if only that one is set. So if you can't edit the old
sandbox secret, just **add a new one named `PROBE42_API_KEY_PROD`** with the
production key — it takes precedence automatically, no code change needed.

### Optional — non-secret config (only when Probe42's POC confirms the prod endpoint)

Add these as **Variables** (same screen, "Variables" tab), not secrets:

| Variable                | Value                                             |
| ----------------------- | ------------------------------------------------- |
| `PROBE42_ENV`           | `prod`                                             |
| `PROBE42_BASE_URL`      | prod base URL, if different from `https://api.probe42.in` |
| `PROBE42_PATH_PREFIX`   | the current path segment from Probe42's POC       |
| `PROBE42_REPORT_PREFIX` | the current report segment from Probe42's POC     |

## Step 2 — Verify the setup (0 credits)

Actions tab → **"Probe42 VPN check (0 credits)"** → **Run workflow**.

It will:
1. Confirm all 4 secrets are present (never printing their values).
2. Connect the VPN.
3. Print the runner's public IP **before and after** connecting.

✅ Success = the "after" IP matches the IP Probe42 has whitelisted. It does **not**
call Probe42, so it costs nothing.

## Step 3 — (later, together) actually pull data

Once the VPN check is green, we wire the same VPN-connect steps into
`.github/workflows/probe-refresh.yml` (the real pull) and do a tiny **1-company**
test run to confirm real data flows — then decide how to spend the rest of the
credits. That pull is **manual-only** and limited per run, so it never surprises
you on cost.
