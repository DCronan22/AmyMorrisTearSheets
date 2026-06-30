import { unzipSync } from "fflate";
import type { Item } from "./types";
import { emptyItem } from "./types";
import { compressImageFile } from "./lib/extract";
import type { ImportResult } from "./spreadsheet";

/**
 * Import a PowerPoint tear-sheet deck (.pptx). Each slide becomes one item:
 * the slide text is parsed for name / dimensions / price / lead time / room
 * (matching the Amy Morris template), the largest non-logo image on the slide
 * becomes the product photo, and the price line's "+ Fabric" wording sets the
 * upholstered flag. A .pptx is just a ZIP of XML + media, so we unzip it and
 * read the parts directly — no server round-trip.
 */
export async function parsePptx(file: File): Promise<ImportResult> {
  let files: Record<string, Uint8Array>;
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    files = unzipSync(buf);
  } catch {
    // Not a readable ZIP / .pptx (corrupt, truncated, or wrong file type):
    // there's nothing to import, so return empty rather than throwing.
    return { items: [], matchedColumns: [], skippedRows: 0 };
  }

  const slidePaths = Object.keys(files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => slideNum(a) - slideNum(b));

  const items: Item[] = [];
  const fieldsSeen = new Set<string>();
  let skipped = 0;

  for (const path of slidePaths) {
    try {
      const xml = textOf(files[path]);
      const parsed = parseSlide(xml);

      // A usable tear sheet needs at least a name or a product photo.
      const imgPath = chooseProductImage(files, path, xml);
      if (!parsed.name && !imgPath) {
        skipped++;
        continue;
      }

      const item = emptyItem();
      if (parsed.name) {
        item.name = parsed.name;
        fieldsSeen.add("Item");
      }
      if (parsed.room) {
        item.room = parsed.room;
        fieldsSeen.add("Room");
      }
      if (parsed.dimensions) {
        item.dimensions = parsed.dimensions;
        fieldsSeen.add("Dimensions");
      }
      if (parsed.leadTime) {
        item.leadTime = parsed.leadTime;
        fieldsSeen.add("Lead Time");
      }
      if (parsed.price !== null) {
        item.price = parsed.price;
        fieldsSeen.add("Price");
      }
      item.upholstered = parsed.upholstered;

      if (imgPath && files[imgPath]) {
        try {
          const bytes = files[imgPath];
          const ab = bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength
          ) as ArrayBuffer;
          const blob = new File([ab], baseName(imgPath), {
            type: mimeFor(imgPath),
          });
          item.imageUrl = await compressImageFile(blob);
          fieldsSeen.add("Photo");
        } catch {
          // Leave the photo blank if the image can't be decoded.
        }
      }

      items.push(item);
    } catch {
      // A single malformed slide shouldn't abort the whole deck; skip it and
      // keep parsing the rest.
      skipped++;
    }
  }

  return { items, matchedColumns: [...fieldsSeen], skippedRows: skipped };
}

interface ParsedSlide {
  name: string;
  room: string;
  dimensions: string;
  leadTime: string;
  price: number | null;
  upholstered: boolean;
}

// Label prefixes, matched case-insensitively with flexible whitespace. The
// Amy Morris template uses "Dimensions/Price/Lead Time/Room", but real decks
// drift into synonyms ("Dims", "Size", "Cost", "Availability"), so accept those.
const DIM_RE = /^(?:dimensions?|dims|size)\s*:\s*/i;
const PRICE_RE = /^(?:price|cost)\s*:\s*/i;
const LEAD_RE = /^(?:lead\s*time|leadtime|lead|availability|avail)\s*:\s*/i;
const ROOM_RE = /^room\s*:\s*/i;

// Empty-template placeholders that should never be treated as a product name.
const PLACEHOLDER_RE =
  /^(?:room name|product name|item name|click to add (?:a )?(?:text|title)|title|text|untitled)$/i;
const isPlaceholder = (t: string) => !t || PLACEHOLDER_RE.test(t.trim());

/** Parse one slide's XML into tear-sheet fields. Exported for testing. */
export function parseSlide(xml: string): ParsedSlide {
  const lines = textLines(xml);

  let dimensions = "";
  let leadTime = "";
  let priceLine = "";
  let roomLabeled = "";
  const leftovers: string[] = [];

  for (const t of lines) {
    if (DIM_RE.test(t)) {
      dimensions = t.replace(DIM_RE, "").trim();
    } else if (PRICE_RE.test(t)) {
      priceLine = t.replace(PRICE_RE, "").trim();
    } else if (LEAD_RE.test(t)) {
      leadTime = t.replace(LEAD_RE, "").trim();
    } else if (ROOM_RE.test(t)) {
      roomLabeled = t.replace(ROOM_RE, "").trim();
    } else {
      leftovers.push(t);
    }
  }

  // Name is the first real (non-placeholder) line; room is an explicit "Room:"
  // line if present, otherwise the next real line after the name.
  const usable = leftovers.filter((t) => !isPlaceholder(t));
  const name = usable[0] ?? leftovers[0] ?? "";
  const room = roomLabeled || usable.find((t) => t !== name) || "";

  return {
    name,
    room,
    dimensions,
    leadTime,
    price: parsePriceLine(priceLine),
    // "+ Fabric + Freight" => upholstered; "+ Freight" only => not.
    upholstered: priceLine ? /fabric/i.test(priceLine) : true,
  };
}

/** Pull the number out of a price line like "$7,020 + Fabric + Freight". */
function parsePriceLine(line: string): number | null {
  if (!line) return null;
  // Drop "+ Fabric + Freight", then take the FIRST numeric token. Stripping all
  // non-digits would concatenate a range or parenthetical ("$7,020-$9,000",
  // "$1,200 (set of 2)") into a nonsense number (70209000, 12002); grabbing the
  // first token yields the starting price, matching the spreadsheet importer.
  const head = line.split("+")[0];
  const m = head.match(/\d[\d,]*(?:\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Reconstruct the slide's logical text lines in document order. A single line
 * such as `Dimensions: 84"W...` is frequently split across several `<a:t>` runs
 * ("Dimensions:" + " 84\"W..."), so we join all runs within a paragraph
 * (`<a:p>`) — splitting only on hard line breaks (`<a:br/>`) — before matching
 * labels. Decks where each line is already a single run come through unchanged.
 */
function textLines(xml: string): string[] {
  const lines: string[] = [];
  const pRe = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g;
  let p: RegExpExecArray | null;
  let foundParagraph = false;
  while ((p = pRe.exec(xml)) !== null) {
    foundParagraph = true;
    for (const seg of p[1].split(/<a:br\b[^>]*?\/?>/)) {
      const s = runText(seg);
      if (s) lines.push(s);
    }
  }
  // Fallback for unusual markup with no <a:p> wrappers: treat each run as a line.
  if (!foundParagraph) {
    const re = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
      const s = collapse(decodeEntities(m[1]));
      if (s) lines.push(s);
    }
  }
  return lines;
}

/** Concatenate the `<a:t>` runs inside a paragraph fragment into one string. */
function runText(fragment: string): string {
  const re = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g;
  let m: RegExpExecArray | null;
  let s = "";
  // Runs are concatenated verbatim (each carries its own spacing); only the
  // assembled line is whitespace-collapsed, so split labels rejoin correctly.
  while ((m = re.exec(fragment)) !== null) s += decodeEntities(m[1]);
  return collapse(s);
}

/** Collapse runs of whitespace to single spaces and trim. */
function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Pick the product photo for a slide: of the images the slide embeds, drop
 * logo-shaped banners (very wide aspect ratio) and take the largest remaining.
 * Returns the zip path, or "" if the slide has no suitable image.
 */
export function chooseProductImage(
  files: Record<string, Uint8Array>,
  slidePath: string,
  xml: string
): string {
  const relsPath = slidePath.replace(
    /slides\/(slide\d+)\.xml$/,
    "slides/_rels/$1.xml.rels"
  );
  const rels = files[relsPath] ? textOf(files[relsPath]) : "";
  const idToTarget = new Map<string, string>();
  // Parse each <Relationship> element individually so attribute order doesn't
  // matter, external (r:link) images are skipped, and only raster formats we
  // can actually embed are kept (tiff/emf/wmf and friends fall through).
  const relRe = /<Relationship\b[^>]*>/g;
  let r: RegExpExecArray | null;
  while ((r = relRe.exec(rels)) !== null) {
    const tag = r[0];
    if (/TargetMode\s*=\s*"External"/i.test(tag)) continue;
    const id = /\bId\s*=\s*"([^"]+)"/.exec(tag)?.[1];
    const target = /\bTarget\s*=\s*"([^"]+)"/.exec(tag)?.[1];
    if (!id || !target) continue;
    if (!/\.(png|jpe?g|gif|bmp|webp)$/i.test(target)) continue;
    idToTarget.set(id, resolveRel(target));
  }

  const embedRe = /r:embed="([^"]+)"/g;
  const candidates: string[] = [];
  let e: RegExpExecArray | null;
  while ((e = embedRe.exec(xml)) !== null) {
    const target = idToTarget.get(e[1]);
    if (target && files[target] && !candidates.includes(target)) {
      candidates.push(target);
    }
  }

  let best = "";
  let bestArea = 0;
  let anyMeasured = false;
  let fallback = "";
  for (const path of candidates) {
    if (!fallback) fallback = path;
    const size = imageSize(files[path]);
    if (!size || !size.w || !size.h) continue; // dimensions unreadable — defer
    anyMeasured = true;
    const aspect = size.w / size.h;
    // Skip wide logo/banner strips. Only a loose lower bound on tall images so a
    // genuine narrow product shot (floor lamp, mirror, drapery panel) isn't lost.
    if (aspect > 3 || aspect < 1 / 5) continue;
    const area = size.w * size.h;
    if (area > bestArea) {
      bestArea = area;
      best = path;
    }
  }
  if (best) return best;
  // If no candidate's size could be read (e.g. a webp-only slide), fall back to
  // the first embedded image as a best effort. But if we *could* measure and
  // everything left was logo-shaped, return no photo — that's a valid outcome.
  return anyMeasured ? "" : fallback;
}

/**
 * Read pixel dimensions from a raster byte buffer (PNG/JPEG/GIF/BMP). Returns
 * null when the format is unsupported (e.g. webp) or the header is malformed;
 * callers treat that as "size unknown" rather than an error.
 */
function imageSize(bytes: Uint8Array): { w: number; h: number } | null {
  try {
    // PNG: 8-byte signature, then IHDR with width/height at offset 16.
    if (
      bytes.length > 24 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    ) {
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return { w: dv.getUint32(16), h: dv.getUint32(20) };
    }
    // GIF: "GIF8" then little-endian width/height at offsets 6 and 8.
    if (
      bytes.length > 10 &&
      bytes[0] === 0x47 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46
    ) {
      return {
        w: bytes[6] | (bytes[7] << 8),
        h: bytes[8] | (bytes[9] << 8),
      };
    }
    // BMP: "BM" then signed little-endian width/height at offsets 18 and 22.
    if (bytes.length > 26 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return { w: Math.abs(dv.getInt32(18, true)), h: Math.abs(dv.getInt32(22, true)) };
    }
    // JPEG: scan segments for a Start-Of-Frame marker.
    if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
      let i = 2;
      while (i < bytes.length - 9) {
        if (bytes[i] !== 0xff) {
          i++;
          continue;
        }
        const marker = bytes[i + 1];
        const len = (bytes[i + 2] << 8) | bytes[i + 3];
        // SOF0..SOF15 (except DHT=C4, JPG=C8, DAC=CC) carry dimensions.
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          const h = (bytes[i + 5] << 8) | bytes[i + 6];
          const w = (bytes[i + 7] << 8) | bytes[i + 8];
          return { w, h };
        }
        i += 2 + len;
      }
    }
  } catch {
    // Malformed header — fall through to "unknown".
  }
  return null;
}

function resolveRel(target: string): string {
  // Targets are relative to ppt/slides/, e.g. "../media/image2.png".
  return "ppt/" + target.replace(/^\.\.\//, "");
}

function slideNum(path: string): number {
  return parseInt(path.replace(/\D+/g, ""), 10) || 0;
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function mimeFor(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "bmp") return "image/bmp";
  return "image/png";
}

const decoder = new TextDecoder("utf-8");
function textOf(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
}
