# Xiaoma Piano source edition

English desktop web source edition based on the historical 0.3.26 source snapshot. Package version: `0.3.26-oss.0`. This source edition does not establish parity with later installed or deployed versions.

## Included

- Staff rendering and practice controls, score import, and right-hand, left-hand and both-hand practice modes.
- One original two-measure C Major Steps exercise.
- Reproducible additive-synthesis practice tones. These are generated tones, not recordings of commercial pianos or redistributed soundfonts.

Commercial song catalogs, scanned scores, recordings, original sample banks, private deployment settings, signing material and native packaging are excluded. Catalog pages may therefore be empty. Imported files remain the user's responsibility.

## Build status and local preview

A clean isolated installation from the committed npm lockfile passed strict TypeScript checking and a Vite production build. Dependency lifecycle scripts were disabled. This verifies the web build; native packages are not included.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm run build
npx vite preview --host 127.0.0.1
```

The build generates WAV assets into `public/samples/` before compiling. Generated assets and `dist/` are excluded from source control. Serve the build through HTTP; opening `index.html` directly is not a supported preview procedure. The checked build emits a large score-renderer chunk warning.

## Optional build-time configuration

All `VITE_` values are public browser configuration. Never put credentials or secrets in them.

| Variable | Behavior |
| --- | --- |
| `VITE_PIANO_CATALOG_BASE` | Optional HTTP(S) catalog base; no credentials, query or fragment. Unconfigured catalog returns no entries without a fetch. |
| `VITE_PIANO_UPDATE_FEED` | Optional HTTPS feed; no credentials or fragment. Update checks are disabled when absent or invalid. |
| `VITE_PIANO_WEBSITE` | Optional website link. |

No production endpoint, verification key asset or native update installer is supplied. Configuring a URL alone does not provide a functioning catalog or update service.

## Supported scope

This source edition targets desktop web browsers served over HTTP or HTTPS. Mobile layout, microphone pitch input, hardware MIDI and native wrappers are experimental and unverified in this edition. No mobile or desktop installer is supplied.

## Verification and limitations

Actual desktop browser checks, including a repeat against the clean locked dependency build, covered the English home and practice UI, generated-tone loading, Listen completion, pause/restart, and an eight-note right-hand exercise. A generated MusicXML fixture rendered treble and bass staves, completed Listen at 100%, and completed four right-hand on-screen notes without wrong or missed notes.

The Listen terminal-progress defect was corrected and checked in the browser. Refresh persistence passed in a desktop browser: the previously imported generated fixture remained available in the library after a fresh tab and a successful reload. After an initial online load and reload, the owned preview server was stopped and its port was confirmed closed. The app reloaded, opened the retained imported score, rendered its staff and completed generated-tone playback at 100%. This covers an unavailable origin server; storage eviction, private browsing, quota, mobile layout, hardware MIDI, physical audio fidelity and native packaging are not accepted yet. Successful browser sample loading does not establish acoustic fidelity.

## License and distribution

This repository distributes source code; no installer or compiled release is supplied. The application source, original exercise, vector icon and tone-generation scripts use the MIT license, following the other Xiaoma source editions. Third-party components retain their own terms; see `THIRD_PARTY_NOTICES.md`. Verification covers the desktop web scope described above; experimental inputs and native packaging remain unverified.

The build also generates `dist/sw.js` with a revisioned cache of this build's shell, renderer and generated tones. Offline reload requires a successful first online load, completed worker installation and a subsequent page load under that worker. Browser storage can be cleared or evicted. No external catalog content is guaranteed offline.

MXL imports reject archives declaring more than 256 entries, 16 MiB for one entry, or 32 MiB in total before extraction. The compressed input limit is 15 MiB. Malformed archives may still fail to parse.
