---
name: yt-dlp platform quirks
description: Per-platform yt-dlp behavior oddities, YouTube HLS/quality strategy, download routing
---

## YouTube — High Quality (720p/1080p/4K)

Server IPs only get **HLS m3u8 streams** for 720p+ (no PO token). Direct mp4 CDN links require PO tokens (real browser proof).

**Why `--get-url` + ffmpeg fails for YouTube HLS:**
YouTube HLS audio (format 234) uses non-standard AAC extension. ffmpeg rejects with "detected format aac extension mismatches allowed extensions" → ffmpeg exits code 183.

**Fix: temp file approach with merger args:**
```
yt-dlp -f "formatId+bestaudio/best" --merge-output-format mkv
  --no-check-formats
  --postprocessor-args "merger:-allowed_extensions ALL"
  -o /tmp/tmpfile.%(ext)s URL
```
- `--postprocessor-args "merger:-allowed_extensions ALL"` passes `-allowed_extensions ALL` to ffmpeg merger, bypassing the extension check
- Download to temp file, stream to client with Content-Length, delete on close
- This is necessary because stdout piping (`-o -`) fails for HLS video+audio merge

**Client strategy:**
- Default web client: 720p/1080p/4K as HLS — use for high quality
- Android client (`--extractor-args "youtube:player_client=android"`): format 18, 360p combined mp4 — fallback for restricted videos
- iOS, tv_embedded: intermediate fallbacks for info fetching

**Audio stream (YouTube):**
`--get-url` returns HLS manifest → ffmpeg fails. Fix: yt-dlp pipe directly:
`yt-dlp -f "bestaudio[ext=m4a]/bestaudio" -x --audio-format mp3 --audio-quality Nk -o - URL`
yt-dlp handles HLS auth internally for single-stream audio extraction.

**DO NOT install yt-dlp-get-pot** without a running bgutil server — it breaks YouTube extraction.

## YouTube audio-only formats
- `acodec: null` (not `"mp4a.40.2"`) for formats 233, 234
- Detect by `vcodec === "none"` + no height (not by acodec)

## Android combined format (18)
- Always 360p (640x360), ~46-102MB depending on length
- Combined video+audio mp4 — no merge needed, direct CDN URL works
- Accessible from server IPs without PO tokens

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
