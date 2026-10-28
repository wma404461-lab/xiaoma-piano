import type { Song } from "../types";
import {
  artworkPaths,
  getSongArtwork,
  type ArtworkLayer,
} from "../lib/songArtwork";

function ArtworkLayerDrawing({ layer }: { layer: ArtworkLayer }) {
  return (
    <g
      data-art-subject={layer.glyph}
      transform={`translate(${layer.x} ${layer.y}) rotate(${layer.rotate ?? 0}) scale(${layer.scale}) translate(-40 -40)`}
    >
      {artworkPaths[layer.glyph].map((path, index) => (
        <path key={index} d={path} />
      ))}
    </g>
  );
}

export function SongArt({
  song,
  small = false,
}: {
  song: Song;
  small?: boolean;
}) {
  const minor = song.key.endsWith("m");
  const artwork = getSongArtwork(song);
  const layers = small
    ? [
        { ...artwork.layers[0], x: 47, y: 50, scale: 0.96 },
        ...(artwork.layers[1]
          ? [{ ...artwork.layers[1], x: 77, y: 75, scale: 0.34 }]
          : []),
      ]
    : artwork.layers;
  const flowPath = artwork.flow
    ?.map(
      (value, index, values) =>
        `${index === 0 ? "M" : "L"}${24 + (index * 152) / Math.max(1, values.length - 1)} ${109 - value * 1.1}`,
    )
    .join(" ");
  return (
    <div
      className={`song-art art-${song.color} ${small ? "small" : ""}`}
      aria-hidden="true"
    >
      <div className="art-ring ring-one" />
      <div className="art-ring ring-two" />
      <svg
        viewBox={small ? "0 0 100 100" : "0 0 200 120"}
        width={small ? 62 : 156}
        height={small ? 62 : 94}
        style={{
          width: small ? 62 : 156,
          height: small ? 62 : 94,
          maxWidth: "86%",
          marginBottom: small ? 0 : 22,
          overflow: "visible",
        }}
        fill="none"
        stroke="currentColor"
        strokeWidth={small ? 2 : 1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
      >
        {layers.map((layer, index) => (
          <ArtworkLayerDrawing key={index} layer={layer} />
        ))}
        {!small && flowPath && <path d={flowPath} opacity="0.6" />}
      </svg>
      {!small && (
        <span className="art-caption">
          {minor ? song.key.slice(0, -1) : song.key} {minor ? "MINOR" : "MAJOR"}
        </span>
      )}
    </div>
  );
}
