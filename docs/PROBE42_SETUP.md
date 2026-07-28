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

| Secret                 | What to paste                               | Old name (fallback) |
| ---------------------- | ------------------------------------------- | ------------------- |
| `PROBE42_API_KEY_PROD` | your **production** Probe42 API key         | `PROBE42_API_KEY`   |
| `VPN_OVPN`             | the **entire contents** of the `.ovpn` file | `VPN_CONFIG`        |
| `VPN_USER`             | the VPN login name (e.g. `yash`)            | `VPN_USERNAME`      |
| `VPN_PASS`             | the VPN password                            | `VPN_PASSWORD`      |

Key-name note: if you **can't edit or delete** an existing secret, just **add a
new one under the name in the first column** — the workflows read the new name
first and fall back to the old name automatically, so no code change is needed.
You only need to add the ones you're changing; anything already correct can stay
under its old name.

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

## Step 3 — the real pull (spends credits)

The `Probe42 refresh` workflow is now wired: it connects the VPN, routes the
Probe42 host through it, and **hard-aborts before any call if Probe42 isn't
going through the tunnel** — so a misconfig can't burn a credit.

Before the first run, set these repo **Variables** (Settings → Secrets and
variables → Actions → **Variables** tab):

| Variable                | Value                                                     |
| ----------------------- | --------------------------------------------------------- |
| `PROBE42_ENV`           | `prod`                                                    |
| `PROBE42_PATH_PREFIX`   | prod path segment from Probe42's POC (if not `probe_pro`) |
| `PROBE42_REPORT_PREFIX` | prod report segment from Probe42's POC (if different)     |
| `VPN_EXPECTED_EXIT_IP`  | `15.207.17.59` (optional — enables the ✅/⚠️ auto-check)   |

Then Actions → **Probe42 refresh** → Run workflow → set **limit = 1** for the
first test: one company, one small credit spend, to confirm live data flows.
The job is manual-only and limited per run, so cost never surprises you.
