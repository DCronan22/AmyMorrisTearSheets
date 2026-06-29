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
  const buf = new Uint8Array(await file.arrayBuffer());
  const files = unzipSync(buf);

  const slidePaths = Object.keys(files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => slideNum(a) - slideNum(b));

  const items: Item[] = [];
  const fieldsSeen = new Set<string>();
  let skipped = 0;

  for (const path of slidePaths) {
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

    if (imgPath) {
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

/** Parse one slide's XML into tear-sheet fields. Exported for testing. */
export function parseSlide(xml: string): ParsedSlide {
  const runs = textRuns(xml);

  let dimensions = "";
  let leadTime = "";
  let priceLine = "";
  const leftovers: string[] = [];

  for (const t of runs) {
    if (/^dimensions\s*:/i.test(t)) {
      dimensions = t.replace(/^dimensions\s*:\s*/i, "").trim();
    } else if (/^price\s*:/i.test(t)) {
      priceLine = t.replace(/^price\s*:\s*/i, "").trim();
    } else if (/^lead\s*time\s*:/i.test(t)) {
      leadTime = t.replace(/^lead\s*time\s*:\s*/i, "").trim();
    } else {
      leftovers.push(t);
    }
  }

  const isPlaceholder = (t: string) => /^room name$/i.test(t);
  const name = leftovers.find((t) => !isPlaceholder(t)) ?? leftovers[0] ?? "";
  const room =
    leftovers.find((t) => t !== name && !isPlaceholder(t)) ?? "";

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
  const head = line.split("+")[0]; // drop "+ Fabric + Freight"
  const n = parseFloat(head.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** All <a:t> text runs in document order, entity-decoded and trimmed. */
function textRuns(xml: string): string[] {
  const out: string[] = [];
  const re = /<a:t>([\s\S]*?)<\/a:t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const t = decodeEntities(m[1]).trim();
    if (t) out.push(t);
  }
  return out;
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
  const relRe = /Id="([^"]+)"[^>]*Target="([^"]+)"/g;
  let r: RegExpExecArray | null;
  while ((r = relRe.exec(rels)) !== null) {
    if (/\.(png|jpe?g|gif|bmp|webp)$/i.test(r[2])) {
      idToTarget.set(r[1], resolveRel(r[2]));
    }
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
  for (const path of candidates) {
    const size = imageSize(files[path]);
    if (!size) continue;
    const aspect = size.w / size.h;
    if (aspect > 3 || aspect < 1 / 3) continue; // skip logo/banner shapes
    const area = size.w * size.h;
    if (area > bestArea) {
      bestArea = area;
      best = path;
    }
  }
  return best;
}

/** Read pixel dimensions from a PNG or JPEG byte buffer. */
function imageSize(bytes: Uint8Array): { w: number; h: number } | null {
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
      // SOF0..SOF15 (except DHT=C4, DAC=CC, RSTn) carry dimensions.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const h = (bytes[i + 5] << 8) | bytes[i + 6];
        const w = (bytes[i + 7] << 8) | bytes[i + 8];
        return { w, h };
      }
      i += 2 + len;
    }
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
