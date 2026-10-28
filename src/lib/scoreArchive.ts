import { unzipSync } from "fflate";

// Reject oversized ZIP entries before decompression allocates their output.
// These limits apply to declared ZIP sizes; malformed archives can still fail.
export function unpackScoreArchive(bytes: Uint8Array) {
  let total = 0;
  let entries = 0;
  return unzipSync(bytes, {
    filter(entry) {
      entries += 1;
      total += entry.originalSize;
      if (
        entries > 256 ||
        !Number.isSafeInteger(entry.originalSize) ||
        entry.originalSize < 0 ||
        entry.originalSize > 16 * 1024 * 1024 ||
        total > 32 * 1024 * 1024
      ) {
        throw new Error("The MXL archive is too large. Import a smaller single-piece score.");
      }
      return true;
    },
  });
}
