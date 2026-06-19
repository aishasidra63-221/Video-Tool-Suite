---
name: Instagram scraper approach
description: How Instagram video extraction is implemented — layers, what works, what doesn't
---

# Instagram Video Extraction

## Rule
Use 3-layer fallback in `instagramFetch()`. Do NOT rely on yt-dlp alone — Instagram blocks it for most content without cookies.

**Why:** Instagram requires login for most content via yt-dlp in 2025/2026. The embed page is the only reliable no-cookie path for public posts.

## How to apply
Layer 1: GET `https://www.instagram.com/p/{shortcode}/embed/captioned/` — parse `video_url":"..."` or `src="...scontent...mp4..."` from HTML. Works for public posts/reels without login.
Layer 2: og:video meta tag from main page `https://www.instagram.com/p/{shortcode}/` — sometimes exposed for public content.
Layer 3: yt-dlp `--dump-json` — last resort, works for some public content without cookies.

## CDN URL handling
Instagram CDN URLs (scontent.cdninstagram.com) can be returned directly to the browser — they are not IP-restricted like TikTok.
Audio extraction: reuse the `snap_cdn` stream endpoint (`/api/video/stream?snap_cdn=...&audio=true`) — ffmpeg reads the CDN video and extracts MP3.

## Limitations
- Private accounts → all layers fail → clear error shown
- Age-restricted content → fails
- Some public reels may also fail if Instagram blocks the embed
