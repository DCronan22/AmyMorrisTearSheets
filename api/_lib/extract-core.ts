// Core "paste a link → tear sheet" extraction logic. Runs SERVER-SIDE ONLY
// (Vercel serverless function + Vite dev middleware). Never imported by the
// browser bundle, so its Node-only deps are fine.
//
// Tier 1 (this file, free): fetch the product page through an SSRF-guarded
// fetcher and read its built-in structured product data (schema.org JSON-LD,
// OpenGraph/meta). Tier 2 (AI) lives in ./ai-extract.ts and is only used as a
// fallback / for images.

import { parse } from "node-html-parser";
import dnsPromises from "node:dns/promises";
import net from "node:net";

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

const MAX_BYTES = 2_000_000; // 2 MB cap on fetched HTML
const FETCH_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;

// --- SSRF protection -------------------------------------------------------

function ipv4ToParts(ip: string): number[] | null {
  const m = ip.split(".");
  if (m.length !== 4) return null;
  const parts = m.map((p) => Number(p));
  if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return parts;
}

/** Block loopback, private, link-local (incl. cloud metadata), CGNAT, etc. */
function isBlockedIp(ip: string): boolean {
  const type = net.isIP(ip);
  if (type === 4) {
    const p = ipv4ToParts(ip);
    if (!p) return true;
    const [a, b] = p;
    if (a === 0 || a === 10 || a === 127) return true; // this-host, private, loopback
    if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (type === 6) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::") return true; // loopback / unspecified
    if (v.startsWith("fe80")) return true; // link-local
    if (v.startsWith("fc") || v.startsWith("fd")) return true; // unique local
    // IPv4-mapped (::ffff:a.b.c.d)
    const mapped = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedIp(mapped[1]);
    return false;
  }
  return true; // not a valid IP literal → treat as blocked
}

/** Validate scheme + that the host resolves only to public IPs. */
async function assertPublicUrl(rawUrl: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error("That doesn't look like a valid web address.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Only http and https links are supported.");
  }
  // Only the standard web ports — stops the fetcher being used to probe
  // other services (SSH, databases, …) on public hosts.
  if (u.port && u.port !== "80" && u.port !== "443") {
    throw new Error("That address is not allowed.");
  }
  const host = u.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) {
    throw new Error("That address is not allowed.");
  }
  // If host is an IP literal, validate directly; otherwise resolve it.
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new Error("That address is not allowed.");
    return u;
  }
  let addrs: { address: string }[];
  try {
    addrs = await dnsPromises.lookup(host, { all: true });
  } catch {
    throw new Error("Could not reach that website.");
  }
  if (addrs.length === 0 || addrs.some((a) => isBlockedIp(a.address))) {
    throw new Error("That address is not allowed.");
  }
  return u;
}

/** Fetch HTML with redirect re-validation, timeout, and a size cap. */
async function safeFetchHtml(
  rawUrl: string
): Promise<{ html: string; finalUrl: string }> {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = await assertPublicUrl(current);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(u, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; TearSheetsBot/1.0; +https://tearsheets.app)",
          Accept: "text/html,application/xhtml+xml",
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error("The page redirected without a destination.");
      current = new URL(loc, u).toString(); // re-validated at top of loop
      continue;
    }
    if (!res.ok) throw new Error(`The page returned an error (${res.status}).`);

    const ctype = (res.headers.get("content-type") || "").toLowerCase();
    if (!ctype.includes("html") && !ctype.includes("text/")) {
      throw new Error("That link isn't a web page we can read.");
    }
    const buf = await res.arrayBuffer();
    const slice = buf.byteLength > MAX_BYTES ? buf.slice(0, MAX_BYTES) : buf;
    const html = new TextDecoder("utf-8").decode(slice);
    return { html, finalUrl: u.toString() };
  }
  throw new Error("The link redirected too many times.");
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

/** Public entry point: SSRF-guarded fetch of a product URL, then parse it. */
export async function extractFromUrl(rawUrl: string): Promise<ExtractResult> {
  const { html, finalUrl } = await safeFetchHtml(rawUrl);
  return parseProductHtml(html, finalUrl);
}

/** SSRF-guarded fetch returning readable page text (for the AI fallback). */
export async function fetchReadableText(
  rawUrl: string
): Promise<{ text: string; finalUrl: string }> {
  const { html, finalUrl } = await safeFetchHtml(rawUrl);
  const root = parse(html);
  root.querySelectorAll("script,style,noscript,svg,template").forEach((e) =>
    e.remove()
  );
  const body = root.querySelector("body") ?? root;
  const text = body.innerText
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, finalUrl };
}
