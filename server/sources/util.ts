// ─── SHARED INGESTION UTILITIES ─────────────────────────────────────────────

import { readFileSync } from "fs";
import { resolve } from "path";

let envLoaded = false;

/** Load .env into process.env without clobbering real environment vars. */
export function loadEnv() {
  if (envLoaded) return;
  envLoaded = true;
  try {
    const content = readFileSync(resolve(import.meta.dirname ?? ".", "../../.env"), "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (val && !process.env[key]) process.env[key] = val;
    }
  } catch {
    // .env is optional — keys may already be in the environment.
  }
}

const UA = "btc-regime-dashboard/0.1";

export async function fetchJSON<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": UA, ...headers },
  });
  if (!res.ok) throw httpError(res, url);
  return res.json() as Promise<T>;
}

export type HttpError = Error & { status?: number; retryAfterMs?: number };

/** An Error carrying the status and any Retry-After, so withRetry can wait sensibly on 429. */
function httpError(res: Response, url: string): HttpError {
  const err = new Error(`HTTP ${res.status} ${res.statusText} for ${url.split("?")[0]}`) as HttpError;
  err.status = res.status;
  const retryAfter = Number(res.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) err.retryAfterMs = retryAfter * 1000;
  return err;
}

export async function fetchText(url: string, headers: Record<string, string> = {}): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA, ...headers } });
  if (!res.ok) throw httpError(res, url);
  return res.text();
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Retry with exponential backoff. Rate limits and transient 5xx are common.
 *
 * A 429 is different from a flaky 5xx: the limit is per minute, so three retries
 * inside three seconds only confirm it (which is how a coinalyze sync fell through
 * to the fallback providers on 2026-09-16). On 429 wait for the server's
 * Retry-After, or at least 20 s, then 40 s.
 */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3, baseMs = 800): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        const e = err as HttpError;
        const wait = e?.status === 429 ? Math.max(e.retryAfterMs ?? 0, 20000 * (i + 1)) : baseMs * 2 ** i;
        if (e?.status === 429) console.log(`    rate limited; waiting ${Math.round(wait / 1000)}s before retry ${i + 2}/${attempts}`);
        await sleep(wait);
      }
    }
  }
  throw lastErr;
}

/** Epoch seconds or millis → YYYY-MM-DD (UTC). */
export function toDate(ts: number): string {
  return new Date(ts < 1e11 ? ts * 1000 : ts).toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}
