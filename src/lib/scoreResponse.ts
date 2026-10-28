import type { Song } from "../types";
import { appAsset } from "./assets";
import {loadOfflineScore} from "./offlineScores";

/** AAPT unwraps .gz assets and removes the suffix in an APK. Content updates
 * retain the compressed filename, so support both layouts on Android. */
export async function loadScoreAsset(
  asset: string,
  signal?: AbortSignal,
  native = false,
  expectedSha256?: string,
): Promise<Song> {
  return loadOfflineScore(asset,expectedSha256,signal,()=>loadNetworkScoreAsset(asset,signal,native,expectedSha256));
}
async function loadNetworkScoreAsset(asset:string,signal?:AbortSignal,native=false,expectedSha256?:string):Promise<Song> {
  try {
    return await readScoreResponse(
      await fetch(appAsset(asset), { signal }),
      asset,
      expectedSha256,
    );
  } catch (error) {
    if (!native || !asset.endsWith(".json.gz") || signal?.aborted) throw error;
    const bundled = asset.slice(0, -3);
    return readScoreResponse(
      await fetch(appAsset(bundled), { signal }),
      bundled,
      expectedSha256,
    );
  }
}

/** Read legacy JSON and losslessly compressed, lazily fetched catalog scores. */
export async function readScoreResponse(
  response: Response,
  asset: string,
  expectedSha256?: string,
): Promise<Song> {
  if (!response.ok) throw new Error("The score could not be loaded. Please try again.");
  let value: unknown;
  if (asset.endsWith(".json.gz")) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    // A server may already decode a Content-Encoding: gzip response.
    if (
      bytes[0] === 0x1f &&
      bytes[1] === 0x8b &&
      typeof DecompressionStream !== "undefined"
    ) {
      // The browser's streaming inflater keeps large score decompression off
      // the UI thread. Older Android WebViews retain the lossless fallback.
      const stream = new Blob([bytes])
        .stream()
        .pipeThrough(new DecompressionStream("gzip"));
      value = await new Response(stream).json();
    } else {
      const decoded =
        bytes[0] === 0x1f && bytes[1] === 0x8b
          ? (await import("fflate")).gunzipSync(bytes)
          : bytes;
      value = JSON.parse(new TextDecoder().decode(decoded));
    }
  } else {
    value = await response.json();
  }
  if (
    !value ||
    typeof value !== "object" ||
    !Array.isArray((value as Song).measures)
  )
    throw new Error("The score could not be loaded. Please try again.");
  if(expectedSha256){
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),b=>b.toString(16).padStart(2,'0')).join('');
    if(hash!==expectedSha256)throw new Error('Score verification failed. Reload the score.');
    (value as Song).scoreSha256=expectedSha256;
  }
  return value as Song;
}
