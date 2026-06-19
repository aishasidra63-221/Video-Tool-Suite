---
name: yt-dlp platform quirks
description: Per-platform yt-dlp behavior oddities, YouTube client rotation strategy, download routing, anti-detection
---

## YouTube — Client Rotation Strategy (2026-06-19, binary 2026.06.09)

**Working clients:**
- `android_embedded` ✅
- `android_testsuite` ✅
- `android_music` ✅
- `tv_embedded` ✅ (added after ios broke)

**Broken in yt-dlp 2026.06+:**
- `ios` ❌ — "Requested format is not available" on all videos
- `android,ios` ❌
- `web` ❌ — blocked from server IPs for HD
- `mweb` ❌

**Implementation:** `lib/ytdlp-manager.ts` — `withYtClientRotation()`.
- Tracks per-client health (failure count + timestamp)
- 5-min cooldown after 3 failures
- Sorts clients by health before each attempt
- Skips rotation on permanent errors (login, private, copyright)

## Anti-Detection Stack (proven working 2026-06)

| Technique | Flag | Notes |
|-----------|------|-------|
| XFF country rotation | `--xff "US"` | 14 countries; yt-dlp takes 2-letter ISO code only |
| Client rotation | `withYtClientRotation()` | 4 Android/TV clients |
| Request jitter | 200–900ms delay | Prevents burst detection |
| CDN URL cache | 8-min TTL | Reduces real IP exposure |
| In-flight dedup | `Map<url, Promise>` | N users = 1 yt-dlp call |

## XFF Flag Format — IMPORTANT

yt-dlp ONLY accepts:
- `--xff "US"` — 2-letter ISO country code ✅
- `--xff "1.2.3.4/24"` — CIDR block ✅

Does NOT accept:
- `--xff "1.2.3.4"` — bare IP → "Unsupported --xff" error ❌

## Browser Header Spoofing via --add-header — DO NOT USE

Adding `--add-header` headers (User-Agent, Accept-Language, sec-fetch-*) to yt-dlp commands **breaks YouTube extraction in yt-dlp 2026.06+**. The error is "Failed to extract any player response".

**Why:** The newer binary makes internal YouTube API calls where custom headers interfere.
**Also:** `sec-ch-ua` values contain commas+quotes that break shell argument parsing — yt-dlp treats comma-separated parts as separate URLs.
**What works instead:** XFF + client rotation covers 99% of bot detection without header issues.

## curl_cffi / --impersonate Status (2026-06)

- Nix has curl_cffi 0.7.4; yt-dlp needs 0.10+ for `--impersonate`
- All impersonate targets (Chrome/Firefox/Safari/Edge) show "unavailable"
- TLS fingerprinting not feasible in this environment
- The `_wrapper.abi3.so` exists but `requests` submodule missing in 0.7.4

## YouTube HD Video — info extraction

Virtual format IDs (`yt_2160`, `yt_1440`, `yt_1080`, `yt_720`, `yt_480`) returned in info endpoint.
Resolved to proper yt-dlp format selectors at download/stream time.
Download routing: `yt_XXXX` always go to `/stream` endpoint (HD needs video+audio merge).

**Estimated filesize:** `kbps * 1000 / 8 * duration_seconds`. Typical: 4K=15000kbps, 1440p=8000, 1080p=4000, 720p=2500, 480p=1200.

## YouTube audio stream

Format `18/bestaudio` → client rotation → direct CDN URL → ffmpeg `-vn` → MP3.

## Auto-update yt-dlp

`lib/ytdlp-manager.ts` downloads latest binary from GitHub on startup.
- `/home/runner/workspace/bin/yt-dlp-latest`
- Version cached in `/home/runner/workspace/bin/.yt-dlp-version`

## YouTube HLS merger

```
yt-dlp -f "formatId+bestaudio" --merge-output-format mkv --no-check-formats
  --postprocessor-args "merger:-allowed_extensions ALL" -o /tmp/file.%(ext)s URL
```
`--postprocessor-args "merger:-allowed_extensions ALL"` required — without it ffmpeg rejects aac extension mismatch.

## YouTube audio-only formats
- `acodec: null` (not `"mp4a.40.2"`) for formats 233, 234
- Detect by `vcodec === "none"` + no height

## TikTok
- Blocked on server IPs; yt-dlp returns empty stdout
- Use TikWM API instead (tikwm.com, api2.tikwm.com, api3.tikwm.com)

## Facebook
- Formats: `format_id="hd"/"sd"` with `height=None`, `vcodec=None`
- Match by format_id string, not height

## Instagram (complete lockdown since mid-2024)
- ALL unauthenticated access blocked
- Only working: yt-dlp with user session cookies (`--cookies bin/instagram-cookies.txt`)
- Error code `INSTAGRAM_COOKIES_REQUIRED` → frontend shows setup UI
- Cookie helpers in `lib/ytdlp-manager.ts`
