// ─── LIVE BTC PRICE ──────────────────────────────────────────────────────────
// The front page's price tile. Everything else on the page is measured once a
// day from Coin Metrics and dated as such; the price alone is live, because a
// reader glancing at the page expects that number to be current. The regime,
// the gauges and the 7/30/90-day changes keep using the daily data and its date.
//
// Source: CoinGecko, through the key the sUSDe dashboard already uses for its
// BTC price history (pro host, pro header, exactly as that dashboard does it),
// keyless otherwise, and keyless again if the keyed call fails. Cached for 60 s
// server-side so any number of viewers costs one upstream call a minute, and a
// fetch already in flight is shared. When the upstream is down the last good
// value is served, flagged stale; with nothing cached the tile falls back to the
// daily close. Nothing from the request reaches the upstream URL.

export interface LivePrice {
  usd: number;
  /** Percent change over the past 24 hours, as CoinGecko reports it. */
  change24h: number | null;
  /** When CoinGecko last updated the price, ISO UTC. */
  updatedAt: string;
  /** When this server fetched it, ISO UTC. */
  fetchedAt: string;
  source: "coingecko" | "coingecko-keyless";
  /** True when the upstream failed and this is the last good value. */
  stale: boolean;
}

const TTL_MS = 60_000;
const TIMEOUT_MS = 8_000;
const PATH =
  "/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true";

type Quote = { bitcoin?: { usd?: number; usd_24h_change?: number; last_updated_at?: number } };

let cached: LivePrice | null = null;
let inFlight: Promise<LivePrice | null> | null = null;
let lastAttempt = 0;
let lastErrorLogged = 0;

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function fetchQuote(keyed: boolean): Promise<LivePrice> {
  const key = keyed ? process.env.COINGECKO_API_KEY : undefined;
  const url = (key ? "https://pro-api.coingecko.com" : "https://api.coingecko.com") + PATH;
  const headers: Record<string, string> = { Accept: "application/json", "User-Agent": "btc-regime-dashboard/0.1" };
  if (key) headers["x-cg-pro-api-key"] = key;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${key ? "pro-api" : "api"}.coingecko.com`);
  const body = (await res.json()) as Quote;
  const usd = body.bitcoin?.usd;
  if (typeof usd !== "number" || !(usd > 0)) throw new Error("coingecko returned no BTC price");
  const now = new Date();
  const updated = body.bitcoin?.last_updated_at;
  return {
    usd,
    change24h: typeof body.bitcoin?.usd_24h_change === "number" ? body.bitcoin.usd_24h_change : null,
    updatedAt: typeof updated === "number" && updated > 0 ? new Date(updated * 1000).toISOString() : now.toISOString(),
    fetchedAt: now.toISOString(),
    source: key ? "coingecko" : "coingecko-keyless",
    stale: false,
  };
}

async function refresh(): Promise<LivePrice | null> {
  const keyed = Boolean(process.env.COINGECKO_API_KEY);
  try {
    cached = await fetchQuote(keyed);
    return cached;
  } catch (err) {
    let fallbackErr: unknown = null;
    if (keyed) {
      try {
        cached = await fetchQuote(false);
        return cached;
      } catch (e) {
        fallbackErr = e;
      }
    }
    // At most one line a minute: a dead upstream must not fill the log.
    const now = Date.now();
    if (now - lastErrorLogged > TTL_MS) {
      lastErrorLogged = now;
      console.error(`[price] live price unavailable: ${msg(err)}${fallbackErr ? `; keyless: ${msg(fallbackErr)}` : ""}`);
    }
    if (cached) cached = { ...cached, stale: true };
    return cached;
  }
}

/** The live price: at most one upstream attempt a minute, shared between concurrent requests. */
export function getLivePrice(): Promise<LivePrice | null> {
  if (inFlight) return inFlight;
  const now = Date.now();
  if (now - lastAttempt < TTL_MS) return Promise.resolve(cached);
  lastAttempt = now;
  inFlight = refresh().finally(() => {
    inFlight = null;
  });
  return inFlight;
}
