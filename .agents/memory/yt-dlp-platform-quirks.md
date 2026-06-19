---
name: yt-dlp platform quirks
description: Per-platform yt-dlp behavior oddities, YouTube client rotation strategy, download routing
---

## YouTube — Client Rotation Strategy (mid-2026)

**Working clients (tested 2026-06-19):**
- `android,ios` — combined: gets ALL formats (format 18 360p + HD video-only 144p-4K) — BEST
- `ios` — 144p to 2160p video-only formats (vids without audio, need separate audio track)
- `android` — format 18 only (360p combined mp4, no PO token needed) — reliable fallback
- `mweb` — alternate path, lower quality

**Blocked clients (mid-2026):**
- `web` (default): blocked from server IPs for HD
- `tv_embedded`: "no longer supported in this application or device"
- `web_embedded`: "unavailable, error code 152"
- `web_creator`: "sign in required"

**Implementation:** `lib/ytdlp-manager.ts` — `withYtClientRotation()` function.
- Tracks per-client health (failure count + timestamp)
- 5-min cooldown after 3 failures on a client
- Sorts clients by health before each attempt
- Skips rotation on permanent errors (login, private, copyright)

## YouTube HD Video — info extraction

iOS/android,ios clients return HD formats (232=720p, 270=1080p, 614=1080p vp9, 620=1440p, 625=2160p) directly from execAsync — no injection needed. Previous workaround of injecting virtual format IDs (232, 270) was for the default web client which was blocked.

**Why:**
Previous strategy (run default+android in parallel, inject HD ids if none found) was a workaround for web client being blocked. iOS client solved it cleanly.

## YouTube audio stream

Audio works via client rotation → `18/bestaudio` format → get direct CDN URL → ffmpeg `-vn` extract MP3.
- Format 18 (360p combined): direct CDN URL available without PO token
- ffmpeg `-vn` strips video, outputs MP3 at requested bitrate

**DO NOT use:** `--extractor-args "youtube:player_client=web"` for audio — blocked. `tv_embedded` — blocked. `web_embedded` — blocked.

## Auto-update yt-dlp

`lib/ytdlp-manager.ts` downloads latest binary from GitHub releases on every startup.
- Checks GitHub API for `yt-dlp/yt-dlp` latest release tag
- Downloads to `/home/runner/workspace/bin/yt-dlp-latest.tmp`, chmods 755, verifies with `--version`, then moves to `.../yt-dlp-latest`
- Version cached in `/home/runner/workspace/bin/.yt-dlp-version`
- **Must chmod before verify** — curl download has no execute bit by default
- Runs in background (non-blocking startup)
- getYtDlpBin() returns custom binary if exists, otherwise falls back to system `yt-dlp`

## YouTube HLS merger fix

yt-dlp temp-file approach for HLS downloads (720p+):
```
yt-dlp -f "formatId+bestaudio/formatId/best" --merge-output-format mkv
  --no-check-formats
  --postprocessor-args "merger:-allowed_extensions ALL"
  -o /tmp/tmpfile.%(ext)s URL
```
`--postprocessor-args "merger:-allowed_extensions ALL"` is required — without it, ffmpeg rejects the aac extension mismatch.
Stream the merged MKV file to client with Content-Length, delete on close.

## YouTube audio-only formats
- `acodec: null` (not `"mp4a.40.2"`) for formats 233, 234
- Detect by `vcodec === "none"` + no height (not by acodec)

## TikTok
- Blocked on server IPs; yt-dlp returns empty stdout (no JSON, no error)
- Return user-friendly error about server-side restrictions

## Facebook
- Formats: `format_id="hd"/"sd"` with `height=None`, `vcodec=None`
- Height-based detection gives 0 results; match by format_id string instead

## Instagram
- Combined format has `vcodec=null` (JSON null), not string "none"
- Include formats with `height > 0` regardless of vcodec string
- `--get-url` returns direct CDN mp4 — safe to return to browser

## Download routing
- Direct CDN (non-HLS) → return URL directly to browser
- HLS or merged → `/api/video/stream` (temp file → MKV → stream → cleanup)
- YouTube: always use stream endpoint, never direct CDN return
