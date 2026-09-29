// Loading a whole set of photos without tripping the photo server's rate limit.
//
// Supabase Storage answers 429 "too many requests" when one browser asks for a
// few hundred photos within seconds. On 2026-09-21 the (then always-mounted)
// hidden inventory print layout requested all 414 inventory photos on page
// load and 143 were refused — each one then showed as the "no image"
// placeholder, on screen and in the print. The logs show the limit's shape:
// a burst of ~100 is served, then only a trickle per second until it refills.
//
// So everything that needs many photos goes through here: a small pool of
// concurrent requests, a shared pacer that spaces out requests to our storage
// and slows down whenever the server refuses one, and a retry with backoff.

/** How many photo requests one task keeps in flight at once. */
export const IMAGE_CONCURRENCY = 6;

const STORAGE_ORIGIN = (() => {
  try {
    return new URL(import.meta.env.VITE_SUPABASE_URL as string).origin;
  } catch {
    return "";
  }
})();

/**
 * True for photos in our own Supabase Storage. Their failures are transient
 * (rate limit, network blip), so they're worth retrying. A vendor's CDN that
 * blocks hotlinking fails the same way every time, so those aren't.
 */
export function isOwnStorageUrl(src: string): boolean {
  if (!STORAGE_ORIGIN) return false;
  try {
    return new URL(src).origin === STORAGE_ORIGIN;
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Wait before retry number `attempt` (1-based): ~0.6s, 1.2s, 2.4s, 4.8s. */
function backoffMs(attempt: number, retryAfter?: string | null): number {
  const s = retryAfter ? Number(retryAfter) : NaN;
  if (Number.isFinite(s) && s > 0) return Math.min(s * 1000, 10_000);
  return Math.min(600 * 2 ** (attempt - 1), 8000) + Math.random() * 300;
}

/** Tries per photo (first request included). */
const OWN_TRIES = 6;
const OTHER_TRIES = 2;

/** Give up on a single request that hasn't answered in this long. */
const REQUEST_TIMEOUT_MS = 30_000;

// The pacer: one per tab, shared by every request to our storage. Requests
// start at least `gapMs` apart. A refusal doubles the gap (up to 1s) and
// holds every new request back for a second; each photo served shrinks the
// gap again, so a burst that fits under the limit runs at full speed.
const MIN_GAP_MS = 40;
const MAX_GAP_MS = 1000;
const pacer = { gapMs: MIN_GAP_MS, nextStart: 0 };

export async function takeTurn(): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, pacer.nextStart);
  pacer.nextStart = at + pacer.gapMs;
  if (at > now) await sleep(at - now);
}

export function refused(): void {
  pacer.gapMs = Math.min(pacer.gapMs * 2, MAX_GAP_MS);
  pacer.nextStart = Math.max(pacer.nextStart, Date.now() + 1000);
}

export function served(): void {
  pacer.gapMs = Math.max(MIN_GAP_MS, pacer.gapMs * 0.9);
}

/**
 * Run `fn` over `items` with at most `limit` calls in flight. Results keep the
 * input order. `fn` should not throw (a throw rejects the whole pool).
 */
export async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  const lanes = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: lanes }, worker));
  return out;
}

/**
 * fetch() a photo, retrying requests the server turned away. Own-storage
 * photos retry on a 429/5xx or a network error (a 429 sent without CORS
 * headers surfaces as a TypeError). Other hosts retry only on an explicit
 * 429/503: a CORS-blocked vendor image fails fast, exactly as before.
 * Returns the last response (check `ok`) or null if the request never got one.
 */
export async function fetchWithRetry(url: string): Promise<Response | null> {
  const own = isOwnStorageUrl(url);
  const tries = own ? OWN_TRIES : OTHER_TRIES;
  for (let attempt = 1; ; attempt++) {
    if (own) await takeTurn();
    let res: Response;
    try {
      res = await fetch(url, {
        mode: "cors",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      if (!own || attempt >= tries) return null;
      refused();
      await sleep(backoffMs(attempt));
      continue;
    }
    if (res.ok) {
      if (own) served();
      return res;
    }
    const transient =
      res.status === 429 || res.status === 503 || (own && res.status >= 500);
    if (!transient || attempt >= tries) return res;
    if (own) refused();
    await sleep(backoffMs(attempt, res.headers.get("retry-after")));
  }
}

function loadOnce(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => {
      img.onload = img.onerror = null;
      img.src = ""; // cancel the stalled request
      resolve(null);
    }, REQUEST_TIMEOUT_MS);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = src;
  });
}

/**
 * Load one photo with the same kind of request an <img> makes, retrying like
 * fetchWithRetry. (An <img> can't see the status code, so for our storage any
 * failure is treated as the server asking us to slow down.)
 */
async function loadWithRetry(src: string): Promise<HTMLImageElement | null> {
  const own = isOwnStorageUrl(src);
  const tries = own ? OWN_TRIES : OTHER_TRIES;
  for (let attempt = 1; ; attempt++) {
    if (own) await takeTurn();
    const img = await loadOnce(src);
    if (img) {
      if (own) served();
      return img;
    }
    if (attempt >= tries) return null;
    if (own) refused();
    await sleep(backoffMs(attempt));
  }
}

export interface PreloadResult {
  /**
   * The loaded images. Keep a reference until the photos are on the page: a
   * live Image keeps its photo in the document's image cache, so an <img>
   * with the same URL shows it instantly without asking the server again.
   */
  images: HTMLImageElement[];
  /** URLs that still failed after every retry. */
  failed: string[];
}

/**
 * Fetch every photo a print is about to show, a few at a time, before the
 * print layout renders them all at once. Uses the same kind of request an
 * <img> makes, so the layout's <img> tags are served from the cache.
 */
export async function preloadImages(
  srcs: readonly string[],
  onProgress?: (done: number, total: number) => void
): Promise<PreloadResult> {
  const unique = [...new Set(srcs)];
  let done = 0;
  const loaded = await mapPool(unique, IMAGE_CONCURRENCY, async (src) => {
    const img = await loadWithRetry(src);
    done += 1;
    onProgress?.(done, unique.length);
    return img;
  });
  const images: HTMLImageElement[] = [];
  const failed: string[] = [];
  loaded.forEach((img, i) => {
    if (img) images.push(img);
    else failed.push(unique[i]);
  });
  return { images, failed };
}

/**
 * Resolve once every <img> under `root` has finished (loaded or failed), or
 * after `timeoutMs`, whichever is first. Used right before window.print() so
 * the dialog never snapshots a page whose photo is still arriving.
 */
export function waitForImages(
  root: ParentNode | null,
  timeoutMs: number
): Promise<void> {
  if (!root) return Promise.resolve();
  const pending = [...root.querySelectorAll("img")].filter((i) => !i.complete);
  if (pending.length === 0) return Promise.resolve();
  const settled = Promise.all(
    pending.map(
      (img) =>
        new Promise<void>((resolve) => {
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
        })
    )
  ).then(() => undefined);
  return Promise.race([settled, sleep(timeoutMs)]);
}
