// Core "paste a link → tear sheet" extraction logic. Runs SERVER-SIDE ONLY
// (Vercel serverless function + Vite dev middleware). Never imported by the
// browser bundle, so its Node-only deps are fine.
//
// Tier 1 (this file, free): fetch the product page through an SSRF-guarded
// fetcher and read its built-in structured product data (schema.org JSON-LD,
// OpenGraph/meta). Tier 2 (AI) lives in ./ai-extract.ts and is only used as a
// fallback / for images.

import { parse } from "node-html-parser";
import dns from "node:dns";
import type { LookupAddress, LookupOptions } from "node:dns";
import http from "node:http";
import type { IncomingMessage } from "node:http";
import https from "node:https";
import net from "node:net";
import { Readable, pipeline } from "node:stream";
import type { Transform } from "node:stream";
import zlib from "node:zlib";
// NOTE: relative imports MUST include the .js extension (Vercel ESM).
import { UserFacingError } from "./errors.js";

export interface ExtractedFields {
  name?: string;
  vendor?: string;
  collection?: string;
  category?: string;
  sku?: string;
  price?: number | null;
  dimensions?: string;
  material?: string;
  color?: string;
  imageUrl?: string;
  productUrl?: string;
}

export interface ExtractResult {
  fields: ExtractedFields;
  source: "structured" | "ai" | "none";
  warnings: string[];
}

const MAX_BYTES = 2_000_000; // 2 MB cap on fetched (decoded) HTML
// One deadline for the WHOLE fetch: every hop's DNS lookup, connect, headers
// and body. Leaves room for the AI fallback inside the function's maxDuration.
const FETCH_DEADLINE_MS = 10_000;
const MAX_REDIRECTS = 5;
const USER_AGENT =
  "Mozilla/5.0 (compatible; TearSheetsBot/1.0; +https://tearsheets.app)";

// --- SSRF protection -------------------------------------------------------
//
// Only globally-routable unicast addresses may be fetched. Every address is
// checked twice over: literal IPs in the URL up front, and every address a
// hostname resolves to INSIDE the socket's own DNS lookup (guardedLookup), so
// the address that was checked is the address that gets connected to — no
// DNS-rebinding window between "check" and "fetch".

/** The SSRF guard refused an address. Internal — never shown verbatim. */
export class BlockedAddressError extends Error {
  constructor(what: string) {
    super(`Blocked address: ${what}`);
    this.name = "BlockedAddressError";
  }
}

// IANA IPv4 special-purpose registry (+ multicast/reserved). Any address in
// these ranges is refused.
const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // shared address space (CGNAT)
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, incl. 169.254.169.254 cloud metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.31.196.0", 24], // AS112-v4
  ["192.52.193.0", 24], // AMT
  ["192.88.99.0", 24], // deprecated 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["192.175.48.0", 24], // direct delegation AS112
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, incl. 255.255.255.255 broadcast
];

// IPv6: only 2000::/3 (global unicast) is allowed at all — that already
// excludes ::, ::1, ::/96 IPv4-compatible, ::ffff:0:0:0/96, 64:ff9b:1::/48,
// 100::/64 discard, fc00::/7 ULA, fe80::/10 link-local, fec0::/10 site-local,
// ff00::/8 multicast. These special ranges INSIDE 2000::/3 are refused too:
const V6_BLOCKED: [string, number][] = [
  ["2001::", 23], // IETF protocol assignments (Teredo, benchmarking, ORCHID, …)
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4 (embeds an arbitrary IPv4 address)
  ["3fff::", 20], // documentation
];

const v4Blocked = new net.BlockList();
for (const [addr, prefix] of V4_BLOCKED) v4Blocked.addSubnet(addr, prefix, "ipv4");
const v6Blocked = new net.BlockList();
for (const [addr, prefix] of V6_BLOCKED) v6Blocked.addSubnet(addr, prefix, "ipv6");

function ipv4ToParts(ip: string): number[] | null {
  const m = ip.split(".");
  if (m.length !== 4) return null;
  if (m.some((p) => !/^\d{1,3}$/.test(p))) return null;
  const parts = m.map((p) => Number(p));
  if (parts.some((n) => n > 255)) return null;
  return parts;
}

/** Expand an IPv6 literal into its 8 16-bit words, or null if malformed. */
function ipv6ToWords(ip: string): number[] | null {
  if (!net.isIPv6(ip) || ip.includes("%")) return null; // no zone ids
  let s = ip.toLowerCase();
  // Embedded dotted IPv4 tail (e.g. ::ffff:127.0.0.1) → two hex words.
  const lastColon = s.lastIndexOf(":");
  const tail = s.slice(lastColon + 1);
  if (tail.includes(".")) {
    const p = ipv4ToParts(tail);
    if (!p) return null;
    s =
      s.slice(0, lastColon + 1) +
      ((p[0] << 8) | p[1]).toString(16) +
      ":" +
      ((p[2] << 8) | p[3]).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = 8 - head.length - rest.length;
  if (halves.length === 1 ? fill !== 0 : fill < 1) return null;
  const groups = [...head, ...Array<string>(fill).fill("0"), ...rest];
  if (groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

function isBlockedV4(ip: string): boolean {
  const p = ipv4ToParts(ip);
  if (!p) return true;
  return v4Blocked.check(p.join("."), "ipv4");
}

function wordsToV4(hi: number, lo: number): string {
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join(".");
}

function isBlockedV6(ip: string): boolean {
  const w = ipv6ToWords(ip);
  if (!w) return true;
  const zero = (from: number, to: number) => w.slice(from, to).every((x) => x === 0);
  // IPv4-mapped ::ffff:a.b.c.d — the OS connects to the embedded IPv4.
  if (zero(0, 5) && w[5] === 0xffff) return isBlockedV4(wordsToV4(w[6], w[7]));
  // NAT64 well-known prefix 64:ff9b::/96 — a gateway would forward to the
  // embedded IPv4, so it must pass the IPv4 check.
  if (w[0] === 0x64 && w[1] === 0xff9b && zero(2, 6)) {
    return isBlockedV4(wordsToV4(w[6], w[7]));
  }
  // Everything outside global unicast 2000::/3 (incl. ::, ::1 and the
  // deprecated IPv4-compatible ::a.b.c.d form) is refused outright.
  if ((w[0] & 0xe000) !== 0x2000) return true;
  return v6Blocked.check(w.map((x) => x.toString(16)).join(":"), "ipv6");
}

/**
 * True unless `ip` is a well-formed, globally-routable unicast address.
 * Anything that isn't an IP literal counts as blocked. Exported for tests.
 */
export function isBlockedAddress(ip: string): boolean {
  const type = net.isIP(ip);
  if (type === 4) return isBlockedV4(ip);
  if (type === 6) return isBlockedV6(ip);
  return true;
}

/**
 * Syntactic checks on one URL (scheme, port, obvious internal names, literal
 * IP hosts). Hostnames are validated later, at connect time, by guardedLookup.
 */
export function checkUrl(rawUrl: string): URL {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new UserFacingError("That doesn't look like a valid web address.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new UserFacingError("Only http and https links are supported.");
  }
  // No embedded credentials, and only the standard web ports — stops the
  // fetcher being used to probe other services (SSH, databases, …).
  if (u.username || u.password) throw new BlockedAddressError("credentials");
  if (u.port && u.port !== "80" && u.port !== "443") {
    throw new BlockedAddressError(`port ${u.port}`);
  }
  // WHATWG URL already canonicalizes IPv4 shorthands (2130706433, 0x7f.1,
  // 0177.0.0.1, 127.1 → 127.0.0.1) and IPv6 literals for http(s).
  const host = hostOf(u).replace(/\.$/, "");
  if (!host || /^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) {
    throw new BlockedAddressError(host);
  }
  if (net.isIP(host) && isBlockedAddress(host)) throw new BlockedAddressError(host);
  return u;
}

function hostOf(u: URL): string {
  return u.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number
) => void;

/**
 * DNS lookup used by the outbound socket itself: resolves the host, refuses
 * the connection if ANY returned address is non-public, and hands the socket
 * only addresses that passed. Exported for tests.
 */
export function guardedLookup(
  hostname: string,
  options: LookupOptions,
  callback: LookupCallback
): void {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, options.all ? [] : "");
    if (addresses.length === 0 || addresses.some((a) => isBlockedAddress(a.address))) {
      return callback(new BlockedAddressError(hostname), options.all ? [] : "");
    }
    if (options.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
}

/** One GET (no redirect following) through the guarded lookup. */
function requestOnce(u: URL, signal: AbortSignal): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request(
      {
        protocol: u.protocol,
        hostname: hostOf(u),
        port: u.port || undefined,
        path: `${u.pathname}${u.search}`,
        method: "GET",
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Encoding": "gzip, deflate, br",
        },
        lookup: guardedLookup,
        agent: false, // fresh connection; never reuse a pooled socket
        signal,
      },
      resolve
    );
    req.on("error", reject);
    req.end();
  });
}

/** Split a stream into its first chunk and a stream that replays everything. */
async function peekFirst(src: Readable): Promise<{ first: Buffer | null; rest: Readable }> {
  const it = src[Symbol.asyncIterator]();
  const r = await it.next();
  const first: Buffer | null = r.done ? null : Buffer.from(r.value as Buffer);
  async function* replay() {
    if (first) yield first;
    for (;;) {
      const n = await it.next();
      if (n.done) return;
      yield n.value as Buffer;
    }
  }
  return { first, rest: Readable.from(replay(), { objectMode: false }) };
}

/** Undo Content-Encoding (what fetch() did automatically before). */
async function decodeBody(res: Readable, contentEncoding?: string): Promise<Readable> {
  const codings = (contentEncoding ?? "")
    .toLowerCase()
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c && c !== "identity")
    .reverse(); // listed in the order applied → undo last-applied first
  const zopts = {
    // Be as forgiving as fetch() of a truncated final block.
    flush: zlib.constants.Z_SYNC_FLUSH,
    finishFlush: zlib.constants.Z_SYNC_FLUSH,
  };
  let stream = res;
  for (const c of codings) {
    let dec: Transform;
    if (c === "gzip" || c === "x-gzip") {
      dec = zlib.createGunzip(zopts);
    } else if (c === "br") {
      dec = zlib.createBrotliDecompress({
        flush: zlib.constants.BROTLI_OPERATION_FLUSH,
        finishFlush: zlib.constants.BROTLI_OPERATION_FLUSH,
      });
    } else if (c === "deflate") {
      // "deflate" is meant to be zlib-wrapped, but some servers send raw.
      const { first, rest } = await peekFirst(stream);
      stream = rest;
      dec =
        first && first.length > 0 && (first[0] & 0x0f) === 8
          ? zlib.createInflate(zopts)
          : zlib.createInflateRaw(zopts);
    } else {
      throw new UserFacingError("That link isn't a web page we can read.");
    }
    // Errors on either side destroy `dec`, which surfaces in the reader.
    pipeline(stream, dec, () => {});
    stream = dec;
  }
  return stream;
}

/**
 * Read a response body, decoding Content-Encoding, keeping at most `maxBytes`
 * of decoded output. Stops reading (and tears the connection down) as soon as
 * the cap is reached, and aborts mid-body when `signal` fires. Exported for
 * tests.
 */
export async function readBodyCapped(
  res: Readable,
  contentEncoding: string | undefined,
  maxBytes: number,
  signal: AbortSignal
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  let decoded: Readable | null = null;
  const onAbort = () => {
    const err = new Error("Fetch deadline exceeded.");
    decoded?.destroy(err);
    res.destroy(err);
  };
  if (signal.aborted) {
    onAbort();
    throw new Error("Fetch deadline exceeded.");
  }
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    decoded = await decodeBody(res, contentEncoding);
    if (signal.aborted) throw new Error("Fetch deadline exceeded.");
    for await (const chunk of decoded) {
      const b = chunk as Buffer;
      const room = maxBytes - total;
      if (b.length >= room) {
        chunks.push(b.subarray(0, room));
        total += room;
        break; // cap reached — stop reading; finally{} closes the connection
      }
      chunks.push(b);
      total += b.length;
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    decoded?.destroy();
    res.destroy();
  }
  return Buffer.concat(chunks, total);
}

/**
 * Fetch HTML with per-hop re-validation of redirects, one overall deadline
 * covering every hop and the full body, and a streaming size cap.
 *
 * Errors: UserFacingError for messages we wrote; anything else (blocked
 * address, DNS failure, refused connection, timeout) is internal and must be
 * shown to the user only as a generic message.
 */
async function safeFetchHtml(
  rawUrl: string
): Promise<{ html: string; finalUrl: string }> {
  const signal = AbortSignal.timeout(FETCH_DEADLINE_MS);
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = checkUrl(current);
    const res = await requestOnce(u, signal);
    const status = res.statusCode ?? 0;

    if (status >= 300 && status < 400) {
      const loc = res.headers.location;
      res.destroy();
      if (!loc) throw new UserFacingError("The page redirected without a destination.");
      current = new URL(loc, u).toString(); // re-validated at top of loop
      continue;
    }
    if (status < 200 || status >= 300) {
      res.destroy();
      throw new UserFacingError("That page returned an error.");
    }

    const ctype = (res.headers["content-type"] || "").toLowerCase();
    if (!ctype.includes("html") && !ctype.includes("text/")) {
      res.destroy();
      throw new UserFacingError("That link isn't a web page we can read.");
    }
    const buf = await readBodyCapped(
      res,
      res.headers["content-encoding"],
      MAX_BYTES,
      signal
    );
    const html = new TextDecoder("utf-8").decode(buf);
    return { html, finalUrl: u.toString() };
  }
  throw new UserFacingError("The link redirected too many times.");
}

// --- Parsing helpers -------------------------------------------------------

function toPrice(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const n = parseFloat(String(raw).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function firstString(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (Array.isArray(v)) {
      const s = firstString(...v);
      if (s) return s;
    }
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const s = firstString(o.name, o.url, o["@value"]);
      if (s) return s;
    }
  }
  return undefined;
}

/** Walk JSON-LD (handles arrays and @graph) collecting Product-like nodes. */
function collectProducts(node: unknown, out: Record<string, unknown>[]): void {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const n of node) collectProducts(n, out);
    return;
  }
  if (typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  if (Array.isArray(o["@graph"])) collectProducts(o["@graph"], out);
  const t = o["@type"];
  const types = Array.isArray(t) ? t.map(String) : [String(t)];
  if (types.some((x) => /product/i.test(x))) out.push(o);
}

/** Render a schema.org QuantitativeValue (or plain string) to "value unit". */
function quantityToStr(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  // Plain numeric dimension, e.g. width: 32.
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : undefined;
  if (typeof v === "object" && !Array.isArray(v)) {
    const ov = v as Record<string, unknown>;
    // schema.org commonly publishes `value` as a number, which firstString
    // ignores — coerce numbers so numeric dimensions aren't dropped.
    const rawVal = ov.value ?? ov["@value"];
    const val =
      typeof rawVal === "number" && Number.isFinite(rawVal)
        ? String(rawVal)
        : firstString(rawVal);
    if (!val) return undefined;
    const unit = firstString(ov.unitText, ov.unitCode);
    return unit ? `${val} ${unit}` : val;
  }
  return firstString(v);
}

function dimsFromProduct(o: Record<string, unknown>): string | undefined {
  // Try schema.org width/height/depth as QuantitativeValue or string.
  const w = quantityToStr(o.width);
  const h = quantityToStr(o.height);
  const d = quantityToStr(o.depth);
  const parts = [w && `W ${w}`, d && `D ${d}`, h && `H ${h}`].filter(Boolean);
  if (parts.length) return parts.join(" × ");
  return undefined;
}

/** Extract price from a schema.org offers object/array (incl. priceSpecification). */
function priceFromOffers(offers: unknown): number | null {
  const offer = Array.isArray(offers) ? offers[0] : offers;
  if (!offer || typeof offer !== "object") return null;
  const o = offer as Record<string, unknown>;
  let raw: unknown = o.price ?? o.lowPrice ?? o.highPrice;
  if (raw === undefined || raw === null || raw === "") {
    const spec = o.priceSpecification;
    const s = Array.isArray(spec) ? spec[0] : spec;
    if (s && typeof s === "object") {
      const so = s as Record<string, unknown>;
      raw = so.price ?? so.lowPrice ?? so.highPrice;
    }
  }
  return toPrice(raw);
}

/**
 * Read schema.org additionalProperty (PropertyValue rows) and map recognised
 * names into the matching ExtractedFields, without overwriting existing values.
 */
function applyAdditionalProperties(
  o: Record<string, unknown>,
  out: ExtractedFields
): void {
  const add = o.additionalProperty;
  if (!Array.isArray(add)) return;
  for (const row of add) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const name = (firstString(r.name) || "").toLowerCase();
    const value = firstString(r.value, r["@value"]);
    if (!name || !value) continue;
    if (!out.dimensions && /dimension|size|measure/.test(name)) {
      out.dimensions = value;
    } else if (!out.material && /material|finish|fabric/.test(name)) {
      out.material = value;
    } else if (!out.color && /colou?r(way)?/.test(name)) {
      out.color = value;
    } else if (
      !out.collection &&
      /collection|line|series|pattern/.test(name)
    ) {
      out.collection = value;
    }
  }
}

function parseJsonLd(root: ReturnType<typeof parse>): ExtractedFields {
  const out: ExtractedFields = {};
  const products: Record<string, unknown>[] = [];
  for (const el of root.querySelectorAll(
    'script[type="application/ld+json"]'
  )) {
    const txt = el.textContent?.trim();
    if (!txt) continue;
    try {
      collectProducts(JSON.parse(txt), products);
    } catch {
      // Some sites embed multiple/concatenated JSON objects; ignore bad blocks.
    }
  }
  if (products.length === 0) return out;
  const p = products[0];

  out.name = firstString(p.name);
  // brand/manufacturer: string or { name }
  out.vendor = firstString(p.brand, p.manufacturer);
  out.sku = firstString(p.sku, p.mpn, p.productID, p.gtin13, p.gtin);
  out.color = firstString(p.color);
  out.material = firstString(p.material);
  out.category = firstString(p.category);
  out.imageUrl = firstString(p.image);
  const dims = dimsFromProduct(p);
  if (dims) out.dimensions = dims;

  // offers can be an object or an array, possibly with priceSpecification.
  out.price = priceFromOffers(p.offers);

  // additionalProperty rows fill any still-blank recognised fields.
  applyAdditionalProperties(p, out);

  return out;
}

function metaContent(
  root: ReturnType<typeof parse>,
  selectors: string[]
): string | undefined {
  for (const sel of selectors) {
    const el = root.querySelector(sel);
    const c = el?.getAttribute("content")?.trim();
    if (c) return c;
  }
  return undefined;
}

function parseOpenGraph(root: ReturnType<typeof parse>): ExtractedFields {
  const out: ExtractedFields = {};
  out.name = metaContent(root, [
    'meta[property="og:title"]',
    'meta[name="twitter:title"]',
  ]);
  out.imageUrl = metaContent(root, [
    'meta[property="og:image"]',
    'meta[property="og:image:secure_url"]',
    'meta[name="twitter:image"]',
    'meta[name="twitter:image:src"]',
  ]);
  out.vendor = metaContent(root, [
    'meta[property="product:brand"]',
    'meta[property="og:brand"]',
    'meta[property="og:site_name"]',
  ]);
  const price = metaContent(root, [
    'meta[property="product:price:amount"]',
    'meta[property="og:price:amount"]',
    'meta[property="product:price"]',
    'meta[name="twitter:data1"]',
  ]);
  if (price) out.price = toPrice(price);
  return out;
}

/** HTML5 microdata: elements carrying itemprop="..." (content attr or text). */
function parseMicrodata(root: ReturnType<typeof parse>): ExtractedFields {
  const out: ExtractedFields = {};
  const read = (prop: string): string | undefined => {
    const el = root.querySelector(`[itemprop="${prop}"]`);
    if (!el) return undefined;
    // For meta/link/img the value lives in an attribute; otherwise use text.
    const attr =
      el.getAttribute("content") ||
      el.getAttribute("src") ||
      el.getAttribute("href");
    const val = (attr || el.textContent || "").trim();
    return val || undefined;
  };
  out.name = read("name");
  out.vendor = read("brand");
  out.sku = read("sku") || read("mpn") || read("productID");
  out.color = read("color");
  out.material = read("material");
  out.category = read("category");
  out.imageUrl = read("image");
  const price = read("price") || read("lowPrice");
  if (price) out.price = toPrice(price);
  return out;
}

/**
 * Conservative breadcrumb → category heuristic, used only as a last resort.
 * Takes the last meaningful crumb (excluding Home and the product itself).
 */
function categoryFromBreadcrumb(
  root: ReturnType<typeof parse>
): string | undefined {
  const containers = root.querySelectorAll(
    'nav[aria-label*="readcrumb" i], [class*="breadcrumb" i], [id*="breadcrumb" i], ol.breadcrumb, [itemtype*="BreadcrumbList" i]'
  );
  for (const c of containers) {
    const links = c.querySelectorAll("a");
    const crumbs = links
      .map((a) => a.textContent.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .filter((t) => !/^home$/i.test(t));
    if (crumbs.length >= 2) {
      // Last link is usually a parent category (the product itself is often
      // plain text, not a link). Keep it short to avoid grabbing a title.
      const last = crumbs[crumbs.length - 1];
      if (last && last.length <= 40) return last;
    }
  }
  return undefined;
}

function mergeFields(
  primary: ExtractedFields,
  fallback: ExtractedFields
): ExtractedFields {
  const out: ExtractedFields = { ...fallback };
  for (const [k, v] of Object.entries(primary)) {
    if (v !== undefined && v !== null && v !== "") {
      (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

/** Parse already-fetched HTML into product fields (pure; no network). */
export function parseProductHtml(html: string, finalUrl: string): ExtractResult {
  const root = parse(html);

  const jsonLd = parseJsonLd(root);
  const og = parseOpenGraph(root);
  const microdata = parseMicrodata(root);

  // Priority: JSON-LD (richest) > microdata > OpenGraph/meta.
  const fields = mergeFields(jsonLd, mergeFields(microdata, og));

  // Fall back to <title> for the name if nothing else worked.
  if (!fields.name) {
    const title = root.querySelector("title")?.textContent?.trim();
    if (title) fields.name = title.split(/[|–—-]/)[0].trim();
  }

  // Last-resort, conservative category from a breadcrumb trail.
  if (!fields.category) {
    const cat = categoryFromBreadcrumb(root);
    if (cat) fields.category = cat;
  }

  // Resolve relative image URLs against the page.
  if (fields.imageUrl) {
    try {
      fields.imageUrl = new URL(fields.imageUrl, finalUrl).toString();
    } catch {
      delete fields.imageUrl;
    }
  }
  fields.productUrl = finalUrl;

  const hasData = Object.values(fields).some(
    (v) => v !== undefined && v !== null && v !== "" && v !== finalUrl
  );
  const warnings: string[] = [];
  if (!hasData) warnings.push("No product details were found on that page.");

  return {
    fields,
    source: hasData ? "structured" : "none",
    warnings,
  };
}

/**
 * Public entry point: SSRF-guarded fetch of a product URL, then parse it.
 * The raw HTML is returned alongside the result so the AI fallback can reuse
 * it without a second fetch of the same page.
 */
export async function extractFromUrl(
  rawUrl: string
): Promise<{ result: ExtractResult; html: string; finalUrl: string }> {
  const { html, finalUrl } = await safeFetchHtml(rawUrl);
  return { result: parseProductHtml(html, finalUrl), html, finalUrl };
}

/** Strip already-fetched HTML down to readable text (for the AI fallback). */
export function htmlToReadableText(html: string): string {
  const root = parse(html);
  root.querySelectorAll("script,style,noscript,svg,template").forEach((e) =>
    e.remove()
  );
  const body = root.querySelector("body") ?? root;
  return body.innerText
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
