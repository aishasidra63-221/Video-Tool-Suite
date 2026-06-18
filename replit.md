# VideoTools Pro

Free video downloader supporting YouTube, TikTok, Instagram, Facebook, Snapchat, and Twitter/X — no watermarks, no login, multiple quality options.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/videotools-pro run dev` — run the frontend (port varies)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite, TailwindCSS v4, Framer Motion, wouter
- API: Express 5 with express-rate-limit
- Video processing: yt-dlp + ffmpeg (system deps)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — OpenAPI source of truth
- `artifacts/api-server/src/routes/video.ts` — yt-dlp integration, video info + download stream
- `artifacts/videotools-pro/src/` — React frontend
- `artifacts/videotools-pro/index.html` — SEO meta tags, Google Fonts

## Architecture decisions

- yt-dlp called via child_process from Node.js API server — no Python wrapper needed
- Download streaming via `/api/video/stream` GET endpoint that pipes yt-dlp stdout to response
- `/api/video/download` POST returns a signed-style URL pointing to the stream endpoint
- Rate limiting: 20 req/min per IP on all /api/video/* endpoints
- Platform detection done on both frontend (URL chips, border color) and backend (validation)

## Product

Users paste any YouTube/TikTok/Instagram/Facebook/Snapchat/Twitter video URL, the site fetches available formats via yt-dlp, and lets them download in up to 4K video or MP3 audio. No account needed. Full legal pages included (Privacy, Terms, Disclaimer, DMCA).

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- yt-dlp and ffmpeg are system deps (installed via Nix) — must be present at runtime
- YouTube format merging (video+audio) uses yt-dlp's `bestvideo+bestaudio` and streams merged via ffmpeg pipe
- Google Fonts is loaded in index.html (not index.css) to avoid PostCSS @import order warnings
- Always run `pnpm --filter @workspace/api-spec run codegen` after any openapi.yaml change

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
