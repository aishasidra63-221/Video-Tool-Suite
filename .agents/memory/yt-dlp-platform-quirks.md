---
name: yt-dlp platform quirks
description: Per-platform yt-dlp behavior oddities that affect format detection and download routing
---

## YouTube
- `--dump-json` audio-only formats (233, 234) return `acodec: null` (not `"mp4a.40.2"`)  
- Filter `f.acodec && f.acodec !== "none"` misses them; detect by `vcodec === "none"` + no height instead
- `--get-url` on video-only formats returns an HLS manifest (`manifest.googlevideo.com/api/manifest/hls_playlist/`) — NOT a direct mp4
- **How to apply:** Always route YouTube video downloads through the stream endpoint (ffmpeg merge); never return CDN URL directly for YouTube

## TikTok
- Completely blocked on server IPs; yt-dlp returns empty stdout (no JSON, no error to stderr)
- **How to apply:** Detect empty output and return a user-friendly error about server-side restrictions

## Facebook
- Formats return `format_id="hd"/"sd"` with `height=None`, `vcodec=None`, `acodec=None`
- Height-based format detection produces 0 results; need fallback to match by format_id string ("hd"/"sd")

## Instagram
- Combined format (id=8 typically) has `vcodec=null` (Python None → JSON null), not string "none"
- Filter `f.vcodec && f.vcodec !== "none"` skips null; fix: include any format with `height > 0` and `vcodec !== "none"` string
- `--get-url` returns direct CDN mp4 URL — safe to return to browser directly

## Download routing rule
- Direct CDN (Instagram, Facebook etc.) → return URL directly if NOT HLS (no `/manifest/` or `.m3u8`)
- HLS or merged needed → use `/api/video/stream` endpoint (ffmpeg to MKV via matroska format)

## Stream endpoint
- For merged video+audio: `ffmpeg -i vidUrl -i audUrl -c:v copy -c:a aac -f matroska pipe:1`
- For audio: `ffmpeg -i audioUrl -vn -c:a libmp3lame -b:a <bitrate>k -f mp3 pipe:1`
- Output MKV (matroska) not mpegts — MKV is seekable and plays in all video players
