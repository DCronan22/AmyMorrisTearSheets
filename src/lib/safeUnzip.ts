import { unzipSync } from "fflate";

/**
 * Ceiling on how much we'll inflate out of one imported .pptx/.docx. A real
 * photo-heavy deck stays well below this (photos are already compressed, so
 * they barely grow), but a crafted "zip bomb" can declare gigabytes of output
 * from a few KB of input and freeze or crash the tab.
 */
export const MAX_UNZIPPED_BYTES = 300 * 1024 * 1024;
/** Upper bound on the number of entries we'll extract from one archive. */
export const MAX_UNZIPPED_ENTRIES = 5000;

/** Thrown when an archive would inflate past the limits above. */
export class ArchiveTooLargeError extends Error {
  constructor(message = "This file expands to more data than we can safely import.") {
    super(message);
    this.name = "ArchiveTooLargeError";
  }
}

/**
 * Unzip only the entries `want` asks for, throwing once the running total of
 * declared uncompressed sizes of the wanted entries exceeds `maxBytes` (entries
 * before that point may already have been inflated). Entries we don't need
 * (videos, fonts, embedded workbooks…) are never inflated at all.
 *
 * If an entry under-reports its size, fflate inflates into a buffer of exactly
 * the declared size, so memory stays bounded by the declared total either way
 * (CPU time is not: a hostile file can still keep the tab busy while it decodes).
 */
export function unzipLimited(
  data: Uint8Array,
  want: (name: string) => boolean,
  maxBytes = MAX_UNZIPPED_BYTES,
  maxEntries = MAX_UNZIPPED_ENTRIES
): Record<string, Uint8Array> {
  let total = 0;
  let count = 0;
  return unzipSync(data, {
    filter(file) {
      if (!want(file.name)) return false;
      // Deflate never grows data by more than a few bytes per block, so a
      // compressed size well above the declared output means a lying header.
      const declared = file.originalSize;
      if (
        file.compression === 8 &&
        file.size > declared + Math.ceil(declared / 1000) + 1024
      ) {
        throw new ArchiveTooLargeError();
      }
      total += Math.max(declared, file.size);
      count++;
      if (total > maxBytes || count > maxEntries) {
        throw new ArchiveTooLargeError();
      }
      return true;
    },
  });
}

/** Raster formats the importers can turn into a product photo. */
export const RASTER_IMAGE = /\.(png|jpe?g|gif|bmp|webp)$/i;
