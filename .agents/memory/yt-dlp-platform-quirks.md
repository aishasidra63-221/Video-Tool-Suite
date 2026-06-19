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
- iOS, tv_embedded: BLOCKED as of mid-2026 — do not use for audio

**Audio stream (YouTube) — as of mid-2026:**
ios → "not available on this app". tv_embedded → "no longer supported". web client → "Requested format is not available" (audio-only streams blocked from server IPs without PO tokens). ALL three blocked.

**ONLY working approach:** android client → format 18 (360p combined mp4, no PO token needed from server IPs) → ffmpeg `-vn` extract audio as MP3.
```
yt-dlp -f "18" --get-url --no-warnings --extractor-args "youtube:player_client=android" URL
→ ffmpeg -i <direct_url> -vn -c:a libmp3lame -b:a Nk -f mp3 pipe:1
```
File size is proportional to duration: 3min song ≈ 3MB, 43min video ≈ 41MB at 128kbps — this is correct and expected.
Do NOT try `--extractor-args "youtube:player_client=web"` for audio — also fails from server IPs.
Do NOT pipe `yt-dlp.stdout` to `res` when there is a fallback — pipe auto-closes response on process exit, blocking the fallback. Use `execAsync --get-url` + separate ffmpeg spawn instead.

**DO NOT install yt-dlp-get-pot** without a running bgutil server — it breaks YouTube extraction.

## YouTube audio-only formats
- `acodec: null` (not `"mp4a.40.2"`) for formats 233, 234
- Detect by `vcodec === "none"` + no height (not by acodec)

## Android combined format (18)
- Always 360p (640x360), ~46-102MB depending on length
- Combined video+audio mp4 — no merge needed, direct CDN URL works
- Accessible from server IPs without PO tokens
- Audio quality: 128kbps AAC — good enough for MP3 extraction

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
