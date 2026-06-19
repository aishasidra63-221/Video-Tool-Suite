import { Router } from "express";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import { existsSync, statSync, createReadStream, unlink } from "fs";
import https from "https";
import { GetVideoInfoBody, GetDownloadUrlBody } from "@workspace/api-zod";
import { getYtDlpBin, withYtClientRotation, withYtClientRotationFast, hasCookies, getCookiesFlag, hasInstagramCookies, getInstagramCookiesFlag, getXffFlag, getBrowserHeaderFlags, getYtExtractorArgs, ytRateLimiter } from "../lib/ytdlp-manager";

const execAsync = promisify(exec);
const router = Router();

// ── User-Agent rotation (avoids fingerprinting / detection) ──────────────────
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15",
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
];
function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// ── Concurrency Semaphore (caps simultaneous Instagram fetches) ───────────────
class Semaphore {
  private slots: number;
  private queue: Array<() => void> = [];
  constructor(slots: number) { this.slots = slots; }
  acquire(): Promise<void> {
    if (this.slots > 0) { this.slots--; return Promise.resolve(); }
    return new Promise((resolve) => this.queue.push(resolve));
  }
  release(): void {
    if (this.queue.length > 0) { this.queue.shift()!(); }
    else { this.slots++; }
  }
}
const igSemaphore = new Semaphore(4); // max 4 concurrent Instagram fetches

// ── YouTube concurrency semaphore ─────────────────────────────────────────────
// Caps simultaneous yt-dlp info calls — too many parallel calls = server IP flagged
const ytInfoSemaphore = new Semaphore(4);   // max 4 concurrent info fetches
const ytStreamSemaphore = new Semaphore(3); // max 3 concurrent stream/downloads

// ── In-flight deduplication (same URL → share one fetch) ─────────────────────
// Prevents N concurrent users hitting the same URL from making N requests
const igInFlight = new Map<string, Promise<InstagramData>>();
const ytInFlight = new Map<string, Promise<string>>(); // YouTube info deduplication

// ── CDN URL Cache ─────────────────────────────────────────────────────────────
// Cache --get-url results so N users downloading same video = 1 YouTube API hit.
// YouTube CDN URLs (googlevideo.com) stay valid for hours; we cache for 8 min.
interface CdnCacheEntry { urls: string[]; expiresAt: number; }
const cdnUrlCache = new Map<string, CdnCacheEntry>();
const CDN_CACHE_TTL_MS = 8 * 60 * 1000; // 8 minutes

function getCachedCdnUrls(key: string): string[] | null {
  const e = cdnUrlCache.get(key);
  if (!e) return null;
  if (Date.now() > e.expiresAt) { cdnUrlCache.delete(key); return null; }
  return e.urls;
}
function setCachedCdnUrls(key: string, urls: string[]) {
  cdnUrlCache.set(key, { urls, expiresAt: Date.now() + CDN_CACHE_TTL_MS });
  if (cdnUrlCache.size > 300) { // evict expired entries when full
    const now = Date.now();
    for (const [k, v] of cdnUrlCache) { if (v.expiresAt < now) cdnUrlCache.delete(k); }
  }
}

// ── Stream in-flight deduplication ───────────────────────────────────────────
// Same video+format requested simultaneously → share one get-url fetch,
// then each connection gets its own ffmpeg pipe.
const ytStreamInFlight = new Map<string, Promise<string[]>>();

// ── Per-IP download rate limiter ─────────────────────────────────────────────
// Prevents one user/bot from spamming downloads and getting our server IP flagged.
// Limit: 20 downloads per IP per 10-minute window.
interface IpEntry { count: number; resetAt: number; }
const ipDownloadMap = new Map<string, IpEntry>();
const IP_LIMIT = 20;
const IP_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

function checkIpLimit(ip: string): boolean {
  const now = Date.now();
  let e = ipDownloadMap.get(ip);
  if (!e || now > e.resetAt) { ipDownloadMap.set(ip, { count: 1, resetAt: now + IP_WINDOW_MS }); return true; }
  if (e.count >= IP_LIMIT) return false;
  e.count++;
  return true;
}
// Periodic cleanup to prevent memory growth
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of ipDownloadMap) { if (now > v.resetAt) ipDownloadMap.delete(k); }
  for (const [k, v] of cdnUrlCache) { if (now > v.expiresAt) cdnUrlCache.delete(k); }
}, 15 * 60 * 1000);

const PLATFORM_PATTERNS: Record<string, RegExp[]> = {
  YouTube: [/youtube\.com\/watch/, /youtu\.be\//, /youtube\.com\/shorts\//],
  TikTok: [/tiktok\.com\//],
  Snapchat: [/snapchat\.com/],
  Instagram: [/instagram\.com\/(p|reel|tv)\//],
};

// ── TikTok Multi-API Fallback System ─────────────────────────────────────────
// Multiple free endpoints rotate automatically — effective limit 15,000+/day
const TIKTOK_API_ENDPOINTS = [
  { hostname: "www.tikwm.com",  path: "/api/",  label: "TikWM-Primary"   },
  { hostname: "api2.tikwm.com", path: "/api/",  label: "TikWM-Secondary" },
  { hostname: "api3.tikwm.com", path: "/api/",  label: "TikWM-Tertiary"  },
];

function tikwmFetchFromHost(
  videoUrl: string,
  hostname: string,
  path: string,
  label: string
): Promise<TikWMData> {
  return new Promise((resolve, reject) => {
    const body = `url=${encodeURIComponent(videoUrl)}&hd=1`;
    const options = {
      hostname,
      path,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Referer": `https://${hostname}/`,
        "Origin": `https://${hostname}`,
        "Accept": "application/json, text/plain, */*",
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (json.code !== 0) reject(new Error(`${label}: ${json.msg || "error"}`));
          else resolve(json.data as TikWMData);
        } catch {
          reject(new Error(`${label}: invalid JSON`));
        }
      });
    });
    req.on("error", (e) => reject(new Error(`${label}: ${e.message}`)));
    req.setTimeout(20000, () => { req.destroy(); reject(new Error(`${label} timeout`)); });
    req.write(body);
    req.end();
  });
}

// Tries each endpoint in order — next one used automatically if previous fails
async function tikwmFetch(videoUrl: string): Promise<TikWMData> {
  let lastError: Error = new Error("All TikTok APIs failed");
  for (const ep of TIKTOK_API_ENDPOINTS) {
    try {
      return await tikwmFetchFromHost(videoUrl, ep.hostname, ep.path, ep.label);
    } catch (err) {
      lastError = err as Error;
    }
  }
  throw lastError;
}

interface TikWMData {
  id: string;
  title: string;
  cover: string;
  duration: number;
  play: string;
  hdplay: string;
  wmplay: string;
  music: string;
  music_info?: { title?: string; author?: string };
  author?: { nickname?: string; avatar?: string };
}

// ── Snapchat Scraper — extracts video from __NEXT_DATA__ like competitors ─────
interface SnapchatData {
  title: string;
  uploader: string | null;
  thumbnail: string | null;
  videoUrl: string;
  duration: number | null;
}

function snapHttpGet(url: string, maxRedirects = 8): Promise<string> {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error("Snapchat: too many redirects"));
    let parsed: URL;
    try { parsed = new URL(url); } catch { return reject(new Error("Snapchat: invalid URL")); }
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "identity",
        "Cache-Control": "no-cache",
      },
    }, (res) => {
      // Handle all redirect types including 308
      if (res.statusCode && [301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const loc = res.headers.location.startsWith("http")
          ? res.headers.location
          : "https://www.snapchat.com" + res.headers.location;
        snapHttpGet(loc, maxRedirects - 1).then(resolve).catch(reject);
        return;
      }
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.setTimeout(25000, () => { req.destroy(); reject(new Error("Snapchat fetch timeout")); });
    req.end();
  });
}

// Recursively find all string values matching a predicate
function deepFindStrings(obj: unknown, predicate: (s: string) => boolean, results: string[] = [], depth = 0): string[] {
  if (depth > 25) return results;
  if (typeof obj === "string") {
    if (predicate(obj)) results.push(obj);
  } else if (Array.isArray(obj)) {
    for (const item of obj) deepFindStrings(item, predicate, results, depth + 1);
  } else if (obj && typeof obj === "object") {
    for (const val of Object.values(obj)) deepFindStrings(val, predicate, results, depth + 1);
  }
  return results;
}

async function snapchatFetch(videoUrl: string): Promise<SnapchatData> {
  const html = await snapHttpGet(videoUrl);

  // ── Step 1: og:video meta tag — ALWAYS points to the correct current video ─
  // This is the most reliable source; Snapchat sets it to the exact CDN URL
  // of the video being viewed, not related/trending videos.
  const ogVideoMatch =
    html.match(/<meta[^>]+property="og:video:secure_url"[^>]+content="([^"]+)"/) ||
    html.match(/<meta[^>]+property="og:video"[^>]+content="([^"]+)"/) ||
    html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:video:secure_url"/) ||
    html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:video"/);
  const ogVideoUrl = ogVideoMatch?.[1] || null;

  // ── Step 2: Parse __NEXT_DATA__ for CDN URLs (fallback) ─────────────────
  const match = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/);
  let nextData: unknown = null;
  if (match) {
    try { nextData = JSON.parse(match[1]); } catch { /* ignore */ }
  }

  // ── Step 3: Find the correct video URL ──────────────────────────────────
  // Priority:
  //   1. og:video tag (exact video, most reliable)
  //   2. bolt-gcdn.sc-cdn.net with .27. (video stream CDN pattern)
  //   3. Any mp4 URL from __NEXT_DATA__
  let foundVideoUrl: string | null = ogVideoUrl;

  if (!foundVideoUrl && nextData) {
    // ── Snapchat CDN facts ──────────────────────────────────────────────────
    // Video streams:    bolt-gcdn.sc-cdn.net  with  .27.  in path
    // Thumbnails:       bolt-gcdn.sc-cdn.net  with  .256. in path
    // ── Strategy: find snap belonging to current URL by matching snap ID ───
    const urlSnapId = videoUrl.split("/").filter(Boolean).pop()?.split("?")[0] || "";
    const boltUrls = deepFindStrings(nextData, (s) => s.includes("bolt-gcdn.sc-cdn.net"));
    const videoUrls = boltUrls.filter((u) => u.includes(".27."));

    if (videoUrls.length) {
      // Prefer a URL that contains the snap ID (exact match), else use first
      const exactMatch = videoUrls.find((u) => urlSnapId && u.includes(urlSnapId));
      foundVideoUrl = exactMatch || videoUrls[0];
    }

    if (!foundVideoUrl) {
      // Fallback: any direct .mp4 URL
      const mp4Urls = deepFindStrings(nextData, (s) => s.includes(".mp4") && s.startsWith("https"));
      if (mp4Urls.length) foundVideoUrl = mp4Urls[0];
    }
  }

  if (!foundVideoUrl) {
    throw new Error("Snapchat: no video found — the video may be private, deleted, or not a Spotlight video");
  }

  // ── Title + Username ─────────────────────────────────────────────────────
  // og:title format: "{N} likes | {ACTUAL TITLE} | @user | Posted ... | Snapchat"
  const titleMatch = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/) ||
    html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:title"/);
  let title = "Snapchat Video";
  let uploader: string | null = null;
  if (titleMatch) {
    const raw = titleMatch[1];
    const parts = raw.split(/\s*\|\s*/);
    // Parts: ["2 likes", "Actual Title", "@user", "Posted ...", "Snapchat"]
    // If first part looks like likes/views count, skip it and take next
    const firstIsCount = /^\d+\s*(like|view|watch|share|comment)/i.test(parts[0]);
    if (firstIsCount && parts.length > 1) {
      title = parts[1].trim();
    } else if (parts.length > 1) {
      // Remove "Snapchat" suffix from last part, take first meaningful part
      const filtered = parts.filter((p) => !/^snapchat$/i.test(p.trim()));
      title = filtered[0].trim();
    } else {
      title = raw.replace(/\s*\|\s*Snapchat\s*$/, "").trim();
    }

    // Extract @username — the part starting with "@" in the pipe-separated list
    const userPart = parts.find((p) => p.trim().startsWith("@"));
    if (userPart) uploader = userPart.trim().replace(/^@/, "");
  }

  // ── Thumbnail ────────────────────────────────────────────────────────────
  const ogImageMatch = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/) ||
    html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/);
  let thumbnail: string | null = ogImageMatch?.[1] || null;

  if (!thumbnail && nextData) {
    const boltUrls = deepFindStrings(nextData, (s) => s.includes("bolt-gcdn.sc-cdn.net"));
    const thumbBoltUrls = boltUrls.filter((u) => u.includes(".256."));
    const cfstUrls = deepFindStrings(nextData, (s) => s.includes("cf-st.sc-cdn.net"));
    thumbnail = thumbBoltUrls[0] || cfstUrls[0] || null;
  }

  return {
    title,
    uploader,
    thumbnail,
    videoUrl: foundVideoUrl,
    duration: null,
  };
}

// ── Instagram Scraper ─────────────────────────────────────────────────────────
// 3-layer fallback: embed page → og:video main page → yt-dlp
// Instagram embed page works for public posts/reels without login.
interface InstagramData {
  title: string;
  uploader: string | null;
  thumbnail: string | null;
  videoUrl: string;
  duration: number | null;
}

function igHttpGet(url: string, maxRedirects = 6, ua?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error("Instagram: too many redirects"));
    let parsed: URL;
    try { parsed = new URL(url); } catch { return reject(new Error("Instagram: invalid URL")); }
    const userAgent = ua || randomUA();
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: "GET",
      headers: {
        "User-Agent": userAgent,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "identity",
        "Referer": "https://www.google.com/",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "cross-site",
        "Upgrade-Insecure-Requests": "1",
      },
    }, (res) => {
      if (res.statusCode && [301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const loc = res.headers.location.startsWith("http")
          ? res.headers.location
          : "https://www.instagram.com" + res.headers.location;
        igHttpGet(loc, maxRedirects - 1, userAgent).then(resolve).catch(reject);
        return;
      }
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.setTimeout(18000, () => { req.destroy(); reject(new Error("Instagram fetch timeout")); });
    req.end();
  });
}

// ── Instagram Mobile App API — hidden internal endpoint ───────────────────────
// Instagram's Android/iOS app uses i.instagram.com/api/v1/media/{id}/info/
// This is undocumented but stable. Works for public posts without user cookies.
// Media ID derived from shortcode via base64-like decoding (Instagram's own encoding).

const IG_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function shortcodeToMediaId(shortcode: string): string {
  let id = BigInt(0);
  for (const char of shortcode) {
    const idx = IG_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    id = id * BigInt(64) + BigInt(idx);
  }
  return id.toString();
}

// Rotate between different Instagram app versions to avoid fingerprinting
const IG_MOBILE_UAS = [
  "Instagram 275.0.0.27.98 Android (33; 420dpi; 1080x2400; samsung; SM-G998B; p3q; exynos2100; en_US; 453636739)",
  "Instagram 269.0.0.18.75 Android (31; 440dpi; 1080x2220; OnePlus; IN2020; OnePlus8T; qcom; en_US; 425766902)",
  "Instagram 279.0.0.19.115 Android (34; 480dpi; 1440x3120; Google; Pixel 7; cheetah; tensor; en_US; 462880698)",
  "Instagram 265.0.0.19.301 Android (30; 320dpi; 720x1560; Xiaomi; M2101K6G; alioth; qcom; en_US; 419830688)",
];

function randomMobileUA(): string {
  return IG_MOBILE_UAS[Math.floor(Math.random() * IG_MOBILE_UAS.length)];
}

interface IgMobileItem {
  video_versions?: { url: string; width: number; height: number; type: number }[];
  image_versions2?: { candidates: { url: string }[] };
  user?: { username?: string; full_name?: string };
  caption?: { text?: string } | null;
  media_type?: number; // 1=photo, 2=video, 8=album
  carousel_media?: IgMobileItem[];
  pk?: string;
}

function igMobileApi(mediaId: string, cookiesFlag?: string): Promise<IgMobileItem | null> {
  return new Promise((resolve) => {
    const ua = randomMobileUA();
    // If we have a session cookie string, parse it to send along
    const cookieHeader = cookiesFlag ? "" : ""; // cookies handled via yt-dlp, not here
    const req = https.request({
      hostname: "i.instagram.com",
      path: `/api/v1/media/${mediaId}/info/`,
      method: "GET",
      headers: {
        "User-Agent": ua,
        "X-IG-App-ID": "936619743392459",
        "X-IG-Bandwidth-Speed-KBPS": "-1.000",
        "X-IG-Bandwidth-TotalBytes-B": "0",
        "X-IG-Bandwidth-TotalTime-MS": "0",
        "Accept-Language": "en-US",
        "Accept-Encoding": "identity",
        "Accept": "*/*",
        "Connection": "keep-alive",
      },
    }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (json.items && json.items.length > 0) {
            resolve(json.items[0] as IgMobileItem);
          } else {
            resolve(null);
          }
        } catch { resolve(null); }
      });
    });
    req.on("error", () => resolve(null));
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// Extract best video URL from mobile API item (handles carousels too)
function extractMobileVideoUrl(item: IgMobileItem): string | null {
  // Direct video
  if (item.video_versions?.length) {
    // Sort by highest resolution (type 101 = full, 102 = lower)
    const sorted = [...item.video_versions].sort((a, b) => (b.width * b.height) - (a.width * a.height));
    return sorted[0].url;
  }
  // Carousel — find first video item
  if (item.carousel_media?.length) {
    for (const child of item.carousel_media) {
      const url = extractMobileVideoUrl(child);
      if (url) return url;
    }
  }
  return null;
}

// ── Instagram oEmbed (official API — no auth for public posts) ────────────────
// Returns metadata fast without scraping; does NOT return video URL
function igOembed(shortcode: string): Promise<{ author: string; thumbnail: string | null; title: string } | null> {
  return new Promise((resolve) => {
    const postUrl = encodeURIComponent(`https://www.instagram.com/p/${shortcode}/`);
    const path = `/oembed/?url=${postUrl}&maxwidth=640`;
    const req = https.request({
      hostname: "api.instagram.com",
      path,
      method: "GET",
      headers: {
        "User-Agent": randomUA(),
        "Accept": "application/json",
      },
    }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (json.author_name) {
            resolve({
              author: json.author_name as string,
              thumbnail: (json.thumbnail_url as string) || null,
              title: (json.title as string) || "",
            });
          } else {
            resolve(null);
          }
        } catch { resolve(null); }
      });
    });
    req.on("error", () => resolve(null));
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

async function _instagramFetchCore(videoUrl: string): Promise<InstagramData> {
  const shortcodeMatch = videoUrl.match(/instagram\.com\/(p|reel|tv)\/([A-Za-z0-9_-]+)/);
  if (!shortcodeMatch) throw new Error("Instagram: invalid URL — must be a post, reel, or IGTV link");
  const shortcode = shortcodeMatch[2];

  let videoUrl_: string | null = null;
  let thumbnail: string | null = null;
  let title = "Instagram Video";
  let uploader: string | null = null;

  // ── Layer 0 + 1 + 2 in PARALLEL ───────────────────────────────────────────
  // Instagram has locked ALL unauthenticated endpoints since mid-2024.
  // oEmbed / embed scraping still provide metadata (uploader, thumbnail).
  // The only reliable way to get a video URL is via yt-dlp with user cookies.
  const [oembedResult, embedResult, mainResult] = await Promise.allSettled([
    igOembed(shortcode),
    igHttpGet(`https://www.instagram.com/p/${shortcode}/embed/captioned/`),
    igHttpGet(`https://www.instagram.com/p/${shortcode}/`),
  ]);

  // ── Process Layer 1: embed page ───────────────────────────────────────────
  if (embedResult.status === "fulfilled") {
    const embedHtml = embedResult.value;

    const videoTagMatch = embedHtml.match(/video_url":"([^"]+)"/) ||
      embedHtml.match(/src="(https:\/\/[^"]*scontent[^"]*\.mp4[^"]*)"/) ||
      embedHtml.match(/<video[^>]+src="([^"]+)"/) ||
      embedHtml.match(/videoUrl["']?\s*:\s*["']([^"']+\.mp4[^"']*)/);
    if (videoTagMatch?.[1]) {
      videoUrl_ = videoTagMatch[1].replace(/\\u0026/g, "&").replace(/\\/g, "");
    }

    const thumbMatch = embedHtml.match(/display_url":"([^"]+)"/) ||
      embedHtml.match(/thumbnail_src":"([^"]+)"/) ||
      embedHtml.match(/<img[^>]+src="(https:\/\/[^"]*scontent[^"]*)"[^>]*class="[^"]*EmbedMedia[^"]*"/);
    if (thumbMatch?.[1]) {
      thumbnail = thumbMatch[1].replace(/\\u0026/g, "&").replace(/\\/g, "");
    }

    // Extract username from embed JSON data
    const usernameMatch = embedHtml.match(/"username"\s*:\s*"([^"]+)"/) ||
      embedHtml.match(/class="[^"]*UsernameText[^"]*"[^>]*>([^<]+)</) ||
      embedHtml.match(/"owner"\s*:\s*\{[^}]*"username"\s*:\s*"([^"]+)"/);
    if (usernameMatch?.[1]) uploader = usernameMatch[1];

    // Title from embed caption text
    const captionMatch = embedHtml.match(/<div[^>]+class="[^"]*Caption[^"]*"[^>]*>([\s\S]*?)<\/div>/) ||
      embedHtml.match(/<title>([^<]+)<\/title>/);
    if (captionMatch) {
      const raw = captionMatch[1] || captionMatch[0];
      const cleaned = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
      if (cleaned && cleaned.length > 5) title = cleaned;
    }
  }

  // ── Process Layer 2: main page (og: tags) ────────────────────────────────
  if (mainResult.status === "fulfilled") {
    const mainHtml = mainResult.value;

    if (!videoUrl_) {
      const ogVideoMatch =
        mainHtml.match(/<meta[^>]+property="og:video:secure_url"[^>]+content="([^"]+)"/) ||
        mainHtml.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:video:secure_url"/) ||
        mainHtml.match(/<meta[^>]+property="og:video"[^>]+content="([^"]+)"/) ||
        mainHtml.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:video"/);
      if (ogVideoMatch?.[1]) videoUrl_ = ogVideoMatch[1];
    }

    if (!thumbnail) {
      const ogImageMatch =
        mainHtml.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/) ||
        mainHtml.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/);
      if (ogImageMatch?.[1]) thumbnail = ogImageMatch[1];
    }

    const ogTitleMatch =
      mainHtml.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/) ||
      mainHtml.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:title"/);
    if (ogTitleMatch?.[1]) {
      const rawTitle = ogTitleMatch[1];
      // Extract uploader from "username on Instagram: ..." or "Name (@handle) •"
      if (!uploader) {
        const fromTitle = rawTitle.match(/^"?([^"•\n]+?)\s+on\s+Instagram/i) ||
          rawTitle.match(/^"?([^"•\n]+?)\s*•\s*Instagram/i);
        if (fromTitle?.[1]) uploader = fromTitle[1].replace(/^@/, "").trim();
      }
      // Extract caption as title: 'username on Instagram: "caption text"'
      const captionInTitle = rawTitle.match(/on\s+Instagram\s*:\s*[""](.+?)[""]?\s*$/i);
      if (captionInTitle?.[1]) {
        title = captionInTitle[1].trim().slice(0, 200);
      } else if (title === "Instagram Video") {
        title = rawTitle
          .replace(/\s*on Instagram\s*$/i, "")
          .replace(/^[""]/, "").replace(/[""]$/, "")
          .trim();
      }
    }
  }

  // ── oEmbed metadata (username + thumbnail, no video URL) ─────────────────
  if (oembedResult.status === "fulfilled" && oembedResult.value) {
    const oe = oembedResult.value;
    if (!uploader && oe.author) uploader = oe.author;
    if (!thumbnail && oe.thumbnail) thumbnail = oe.thumbnail;
    if (title === "Instagram Video" && oe.title && oe.title !== `Video by ${oe.author}`) title = oe.title;
  }

  // ── Layer 3: yt-dlp (primary video extractor — try with cookies first) ───────
  if (!videoUrl_) {
    const bin = getYtDlpBin();
    const cookiesFlag = getInstagramCookiesFlag();
    const attempts = cookiesFlag
      ? [`${cookiesFlag}`, ""]          // with cookies first, then without
      : [""];                           // without cookies only

    for (const cf of attempts) {
      try {
        const cmd = `"${bin}" --dump-json --no-playlist --no-warnings --socket-timeout 10 ${cf} "${videoUrl}"`;
        const { stdout } = await execAsync(cmd, { timeout: 20000 });
        const info = JSON.parse(stdout.trim().split("\n")[0]);
        if (info.url) {
          videoUrl_ = info.url;
        } else if (info.formats) {
          const best = (info.formats as any[])
            .filter((f) => f.ext === "mp4" && f.url)
            .slice(-1)[0];
          if (best?.url) videoUrl_ = best.url;
        }
        if (info.thumbnail && !thumbnail) thumbnail = info.thumbnail;
        if (info.title && info.title !== "Instagram Video") title = info.title;
        if (!uploader && info.uploader) uploader = info.uploader;
        if (!uploader && info.uploader_id) uploader = info.uploader_id;
        if (videoUrl_) break;
      } catch { /* try next attempt */ }
    }
  }

  if (!videoUrl_) {
    if (!hasInstagramCookies()) {
      const err = new Error("INSTAGRAM_COOKIES_REQUIRED") as any;
      err.code = "INSTAGRAM_COOKIES_REQUIRED";
      throw err;
    }
    throw new Error("Instagram: post private ho sakta hai ya delete ho gaya ho.");
  }

  return { title, uploader, thumbnail, videoUrl: videoUrl_, duration: null };
}

// ── Public wrapper: semaphore + in-flight deduplication ───────────────────────
async function instagramFetch(videoUrl: string): Promise<InstagramData> {
  const existing = igInFlight.get(videoUrl);
  if (existing) return existing;

  const promise = igSemaphore.acquire().then(async () => {
    try {
      return await _instagramFetchCore(videoUrl);
    } finally {
      igSemaphore.release();
      igInFlight.delete(videoUrl);
    }
  });

  igInFlight.set(videoUrl, promise);
  return promise;
}

function detectPlatform(url: string): string {
  for (const [platform, patterns] of Object.entries(PLATFORM_PATTERNS)) {
    if (patterns.some((p) => p.test(url))) return platform;
  }
  return "Unknown";
}

/** Base flags always applied to every yt-dlp call */
const BASE_FLAGS = "--no-playlist --no-warnings --socket-timeout 10 --no-check-formats";

// ── Random jitter delay — makes requests look less bot-like ──────────────────
// Spreads traffic so YouTube/Instagram don't see perfectly simultaneous bursts
function jitter(minMs = 200, maxMs = 900): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs)) + minMs;
  return new Promise((r) => setTimeout(r, ms));
}

// ── In-memory cache — longer TTL reduces YouTube hits significantly ───────────
interface CacheEntry { data: string; expiresAt: number; }
const infoCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS        = 15 * 60 * 1000;  // 15 min YouTube (was 5 min)
const CACHE_TTL_LONG_MS   = 30 * 60 * 1000;  // 30 min Instagram / Snapchat / TikTok

function getCached(key: string): string | null {
  const entry = infoCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { infoCache.delete(key); return null; }
  return entry.data;
}
function setCache(key: string, data: string, ttl = CACHE_TTL_MS) {
  infoCache.set(key, { data, expiresAt: Date.now() + ttl });
  // Keep up to 2000 entries — evict oldest when full
  if (infoCache.size > 2000) {
    const oldest = infoCache.keys().next().value;
    if (oldest) infoCache.delete(oldest);
  }
}

// Retry transient errors (network/timeout) but not permanent ones (private, removed, login-wall)
const PERMANENT_ERRORS = ["Sign in", "log in", "login", "Private", "not available", "unavailable",
  "removed", "copyright", "unsupported URL", "not available on this app", "no longer supported"];
function isTransientError(msg: string): boolean {
  return !PERMANENT_ERRORS.some((s) => msg.toLowerCase().includes(s.toLowerCase()));
}
async function withRetry<T>(fn: () => Promise<T>, retries = 1, delayMs = 500): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = ((err as Error & { stderr?: string }).stderr || (err as Error).message || "");
      if (!isTransientError(msg)) throw err; // permanent — don't retry
      if (attempt < retries) await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
    }
  }
  throw lastErr;
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

interface YtDlpFormat {
  format_id: string;
  format_note?: string;
  ext?: string;
  vcodec?: string | null;
  acodec?: string | null;
  height?: number | null;
  width?: number | null;
  filesize?: number | null;
  filesize_approx?: number | null;
  tbr?: number | null;
  abr?: number | null;
  asr?: number | null;
  quality?: number | null;
}

interface YtDlpInfo {
  title?: string;
  thumbnail?: string;
  duration?: number;
  formats?: YtDlpFormat[];
  url?: string;
  webpage_url?: string;
  id?: string;
  ext?: string;
  format_id?: string;
  height?: number;
  vcodec?: string;
  acodec?: string;
}

function buildFormats(formats: YtDlpFormat[] | undefined) {
  if (!formats || formats.length === 0) return [];

  const results: Array<{
    formatId: string;
    quality: string;
    label: string;
    type: "video" | "audio";
    filesize: number | null;
    badge: string | null;
  }> = [];

  const seenQualities = new Set<string>();
  const seenFormatIds = new Set<string>();

  // ── VIDEO FORMATS ──────────────────────────────────────────────────────────
  // Include formats with height > 0 AND that aren't audio-only (vcodec !== 'none')
  // Instagram combined formats can have vcodec=null but valid height — include those
  const videoFormats = formats
    .filter(
      (f) =>
        f.height != null &&
        f.height > 0 &&
        f.ext !== "mhtml" &&
        f.vcodec !== "none"
    )
    .sort((a, b) => (b.height || 0) - (a.height || 0));

  const targetHeights = [
    { height: 2160, quality: "4K", label: "4K Ultra HD", badge: "4K" },
    { height: 1440, quality: "1440p", label: "1440p QHD", badge: "QHD" },
    { height: 1080, quality: "1080p", label: "1080p Full HD", badge: "Full HD" },
    { height: 720, quality: "720p", label: "720p HD", badge: "HD" },
    { height: 480, quality: "480p", label: "480p SD", badge: null },
    { height: 360, quality: "360p", label: "360p SD", badge: null },
    { height: 240, quality: "240p", label: "240p Low", badge: null },
  ];

  for (const target of targetHeights) {
    if (seenQualities.has(target.quality)) continue;
    // Find the best match that hasn't already been assigned to another quality bracket
    const match = videoFormats.find(
      (f) =>
        !seenFormatIds.has(f.format_id) &&
        f.height != null &&
        f.height <= target.height &&
        f.height >= target.height * 0.65
    );
    if (match) {
      seenQualities.add(target.quality);
      seenFormatIds.add(match.format_id);
      // Use the actual height when it differs significantly from the target bracket
      const isExact = match.height && match.height >= target.height * 0.9;
      const actualQuality = isExact ? target.quality : `${match.height}p`;
      const actualLabel = isExact ? target.label : `${match.height}p`;
      const actualBadge = isExact ? target.badge : null;
      results.push({
        formatId: match.format_id,
        quality: actualQuality,
        label: actualLabel,
        type: "video",
        filesize: match.filesize || null, // only real filesize, not approx (approx is often wrong)
        badge: actualBadge,
      });
    }
  }

  // Fallback: if height-based detection found nothing, include best video format
  if (!results.some((r) => r.type === "video") && videoFormats.length > 0) {
    const best = videoFormats[0];
    results.push({
      formatId: best.format_id,
      quality: best.height ? `${best.height}p` : "Best",
      label: "Best Available",
      type: "video",
      filesize: best.filesize || null,
      badge: "Best",
    });
  }

  // ── FALLBACK for platforms with named format IDs (Facebook: sd/hd) ────────
  if (!results.some((r) => r.type === "video")) {
    const namedFormats = formats.filter(
      (f) => f.ext === "mp4" && f.vcodec !== "none"
    );
    const hdFmt = namedFormats.find(
      (f) => f.format_id === "hd" || f.format_id.toLowerCase().includes("hd")
    );
    const sdFmt = namedFormats.find(
      (f) => f.format_id === "sd" || f.format_id.toLowerCase().includes("sd")
    );
    if (hdFmt) {
      results.push({
        formatId: hdFmt.format_id,
        quality: "HD",
        label: "HD Quality",
        type: "video",
        filesize: hdFmt.filesize || null,
        badge: "HD",
      });
    }
    if (sdFmt) {
      results.push({
        formatId: sdFmt.format_id,
        quality: "SD",
        label: "SD Quality",
        type: "video",
        filesize: sdFmt.filesize || null,
        badge: null,
      });
    }
    // Last resort: first valid mp4
    if (!results.some((r) => r.type === "video") && namedFormats.length > 0) {
      const f = namedFormats[0];
      results.push({
        formatId: f.format_id,
        quality: "Best",
        label: "Best Available",
        type: "video",
        filesize: f.filesize || null,
        badge: "Best",
      });
    }
  }

  // ── AUDIO FORMATS ──────────────────────────────────────────────────────────
  // yt-dlp sometimes returns acodec=null for audio-only tracks (YouTube 233/234).
  // Detect audio-only by: vcodec='none' AND no height AND not mhtml.
  // Fallback to virtual 'bestaudio' entries when none found.
  const explicitAudio = formats.filter(
    (f) => f.vcodec === "none" && !f.height && f.ext !== "mhtml"
  );

  if (explicitAudio.length > 0) {
    explicitAudio.sort(
      (a, b) => (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0)
    );

    // Show up to 3 distinct quality options based on actual source bitrates
    const seen = new Set<number>();
    const audioOptions: typeof explicitAudio = [];
    for (const f of explicitAudio) {
      const br = Math.round((f.abr || f.tbr || 0) / 10) * 10; // round to nearest 10
      if (!seen.has(br) && br > 0) { seen.add(br); audioOptions.push(f); }
      if (audioOptions.length >= 3) break;
    }

    audioOptions.forEach((f, i) => {
      const srcBr = Math.round(f.abr || f.tbr || 128);
      // Offer MP3 at source bitrate (capped at 320)
      const mp3Br = Math.min(srcBr, 320);
      results.push({
        formatId: `${f.format_id}:audio:${mp3Br}`,
        quality: `${srcBr}kbps`,
        label: `MP3 ~${mp3Br}kbps • ${f.ext?.toUpperCase() ?? "AAC"} source`,
        type: "audio",
        filesize: f.filesize || null,
        badge: i === 0 ? "Best Quality" : null,
      });
    });
  } else {
    // Virtual audio — resolved at stream time using bestaudio selector
    results.push(
      {
        formatId: "bestaudio:audio:128",
        quality: "128 kbps",
        label: "High Quality • 128 kbps",
        type: "audio",
        filesize: null,
        badge: "Best",
      },
      {
        formatId: "bestaudio:audio:64",
        quality: "64 kbps",
        label: "Standard Quality • 64 kbps",
        type: "audio",
        filesize: null,
        badge: null,
      },
      {
        formatId: "bestaudio:audio:32",
        quality: "32 kbps",
        label: "Low Quality • 32 kbps",
        type: "audio",
        filesize: null,
        badge: "Smallest",
      }
    );
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/video/info
// ─────────────────────────────────────────────────────────────────────────────
router.post("/info", async (req, res) => {
  const parsed = GetVideoInfoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request. Provide a valid URL." });
    return;
  }

  const { url } = parsed.data;

  if (!isValidUrl(url)) {
    res.status(400).json({ error: "Invalid URL format." });
    return;
  }

  const platform = detectPlatform(url);
  if (platform === "Unknown") {
    res.status(400).json({
      error: "Unsupported platform. We support YouTube, TikTok and Snapchat.",
    });
    return;
  }

  const isYouTube = platform === "YouTube";
  const isTikTok = platform === "TikTok";
  const isSnapchat = platform === "Snapchat";
  const isInstagram = platform === "Instagram";

  const runInfo = async (clientFlag = "", extraFlags = ""): Promise<string> => {
    const bin = getYtDlpBin();
    const xffFlag = isYouTube ? getXffFlag() : "";
    const cmd = `"${bin}" --dump-json ${BASE_FLAGS} ${clientFlag} ${xffFlag} ${extraFlags} "${url}"`;
    const { stdout } = await execAsync(cmd, { timeout: 35000 });
    return stdout;
  };

  try {
    // ── TikTok: use TikWM API (no watermark, no server-IP blocks) ────────────
    if (isTikTok) {
      const cached = getCached(url);
      let tk: TikWMData;
      if (cached) {
        req.log.info("cache hit (tiktok)");
        tk = JSON.parse(cached);
      } else {
        tk = await tikwmFetch(url);
        setCache(url, JSON.stringify(tk), CACHE_TTL_LONG_MS);
      }
      const formats: Array<{
        formatId: string; quality: string; label: string;
        type: "video" | "audio"; filesize: number | null; badge: string | null;
      }> = [];
      if (tk.hdplay) formats.push({ formatId: "tiktok:hd", quality: "HD", label: "HD Video (no watermark)", type: "video", filesize: null, badge: "HD" });
      if (tk.play)   formats.push({ formatId: "tiktok:sd", quality: "SD", label: "Standard (no watermark)", type: "video", filesize: null, badge: null });
      if (tk.music)  formats.push({ formatId: "tiktok:audio", quality: "audio", label: "Audio (MP3)", type: "audio", filesize: null, badge: null });
      return res.json({
        url, title: tk.title || "TikTok Video",
        thumbnail: tk.cover || null, duration: tk.duration || null,
        platform, formats,
      });
    }

    // ── Snapchat: scrape __NEXT_DATA__ like competitors do ───────────────────
    if (isSnapchat) {
      const cached = getCached(url);
      let snap: SnapchatData;
      if (cached) {
        req.log.info("cache hit (snapchat)");
        snap = JSON.parse(cached);
      } else {
        snap = await snapchatFetch(url);
        setCache(url, JSON.stringify(snap), CACHE_TTL_LONG_MS);
      }
      return res.json({
        url,
        title: snap.title || "Snapchat Video",
        uploader: snap.uploader || null,
        thumbnail: snap.thumbnail || null,
        duration: snap.duration || null,
        platform,
        formats: [
          { formatId: "snapchat:video", quality: "HD", label: "Video (MP4)", type: "video" as const, filesize: null, badge: "HD" },
          { formatId: "snapchat:audio", quality: "MP3", label: "Audio (MP3)", type: "audio" as const, filesize: null, badge: null },
        ],
      });
    }

    // ── Instagram: 3-layer scraper (embed → og:video → yt-dlp) ──────────────
    if (isInstagram) {
      try {
        const cached = getCached(url);
        let ig: InstagramData;
        if (cached) {
          req.log.info("cache hit (instagram)");
          ig = JSON.parse(cached);
        } else {
          ig = await instagramFetch(url);
          setCache(url, JSON.stringify(ig), CACHE_TTL_LONG_MS);
        }
        return res.json({
          url,
          title: ig.title || "Instagram Video",
          uploader: ig.uploader || null,
          thumbnail: ig.thumbnail || null,
          duration: ig.duration || null,
          platform,
          formats: [
            { formatId: "instagram:video", quality: "HD", label: "Video (MP4)", type: "video" as const, filesize: null, badge: "HD" },
            { formatId: "instagram:audio", quality: "MP3", label: "Audio (MP3)", type: "audio" as const, filesize: null, badge: null },
          ],
        });
      } catch (err: any) {
        if (err?.code === "INSTAGRAM_COOKIES_REQUIRED") {
          return res.status(422).json({
            error: "Instagram requires your session cookies to fetch video info.",
            errorCode: "INSTAGRAM_COOKIES_REQUIRED",
          });
        }
        return res.status(422).json({ error: "Unable to fetch Instagram video. Make sure it's a public post or reel." });
      }
    }

    // ── Check cache first ────────────────────────────────────────────────────
    let stdout: string;
    const cached = getCached(url);
    if (cached) {
      req.log.info("cache hit");
      stdout = cached;
    } else if (isYouTube) {
      // ── YouTube: in-flight dedup + semaphore + client rotation ────────────
      // Same URL from N concurrent users → 1 yt-dlp call, rest wait for result
      const existing = ytInFlight.get(url);
      if (existing) {
        req.log.info("YouTube in-flight dedup hit");
        stdout = await existing;
      } else {
        const fetchPromise = ytInfoSemaphore.acquire().then(async () => {
          try {
            await ytRateLimiter.acquire(); // cap server-wide YouTube calls
            let out: string;
            try {
              const { result } = await withYtClientRotationFast((flag) => runInfo(flag));
              out = result;
            } catch (firstErr) {
              const errMsg = ((firstErr as Error & { stderr?: string }).stderr || (firstErr as Error).message || "");
              const isBotBlock = errMsg.toLowerCase().includes("sign in") || errMsg.toLowerCase().includes("bot");
              if (isBotBlock && hasCookies()) {
                req.log.info("Bot block detected, retrying with cookies");
                const cookiesFlag = getCookiesFlag();
                const { result } = await withYtClientRotationFast((flag) => runInfo(flag, cookiesFlag));
                out = result;
              } else {
                throw firstErr;
              }
            }
            setCache(url, out);
            return out;
          } finally {
            ytInfoSemaphore.release();
            ytInFlight.delete(url);
          }
        });
        ytInFlight.set(url, fetchPromise);
        stdout = await fetchPromise;
      }
    } else {
      stdout = await withRetry(() => runInfo());
      setCache(url, stdout);
    }

    const firstLine = stdout.trim().split("\n")[0];
    const info: YtDlpInfo = JSON.parse(firstLine);

    // YouTube: return virtual quality tiers — yt-dlp format list is unreliable
    // without PO token (mid-2026). Actual availability resolved at download time.
    // Estimated filesize = typical_bitrate_bps * duration / 8  (bytes)
    const dur = info.duration ?? 0;
    const estSize = (kbps: number) => dur > 0 ? Math.round(kbps * 1000 / 8 * dur) : null;
    const formats = isYouTube
      ? [
          { formatId: "yt_2160", quality: "4K",    label: "4K Ultra HD",     type: "video" as const, filesize: estSize(15000), badge: "4K" },
          { formatId: "yt_1440", quality: "1440p",  label: "1440p QHD",       type: "video" as const, filesize: estSize(8000),  badge: "QHD" },
          { formatId: "yt_1080", quality: "1080p",  label: "1080p Full HD",   type: "video" as const, filesize: estSize(4000),  badge: "Full HD" },
          { formatId: "yt_720",  quality: "720p",   label: "720p HD",         type: "video" as const, filesize: estSize(2500),  badge: "HD" },
          { formatId: "yt_480",  quality: "480p",   label: "480p SD",         type: "video" as const, filesize: estSize(1200),  badge: null },
          { formatId: "bestaudio:audio:192", quality: "192kbps", label: "MP3 ~192kbps • High Quality", type: "audio" as const, filesize: estSize(192), badge: "Best Quality" },
          { formatId: "bestaudio:audio:128", quality: "128kbps", label: "MP3 ~128kbps • Standard",     type: "audio" as const, filesize: estSize(128), badge: null },
          { formatId: "bestaudio:audio:64",  quality: "64kbps",  label: "MP3 ~64kbps • Small Size",    type: "audio" as const, filesize: estSize(64),  badge: null },
        ]
      : buildFormats(info.formats);

    res.json({
      url,
      title: info.title || "Unknown Video",
      uploader: (info as any).uploader || (info as any).uploader_id || (info as any).channel || null,
      thumbnail: info.thumbnail || null,
      duration: info.duration || null,
      platform,
      formats,
    });
  } catch (err) {
    let stderr: string;
    if (err instanceof AggregateError) {
      stderr = err.errors
        .map((e: Error & { stderr?: string }) => e.stderr || e.message || "")
        .join(" ")
        .slice(0, 600);
    } else {
      const error = err as Error & { stderr?: string };
      stderr = (error.stderr || error.message || "").slice(0, 400);
    }
    req.log.error({ err: stderr }, "video info failed");

    if (isTikTok) {
      const hint = stderr.includes("rate") ? "Rate limit. 1 second baad try karo." : "TikTok video load nahi hua. URL check karo.";
      return res.status(422).json({ error: hint });
    }
    if (stderr.includes("Sign in") || stderr.includes("log in") || stderr.includes("login") || stderr.includes("bot")) {
      const cookiesHint = hasCookies() ? "" : " Settings mein apni YouTube cookies add karo — isse yeh videos bhi kaam karenge.";
      return res.status(422).json({ error: `YouTube is verifying this video and blocking server access.${cookiesHint}`, code: "BOT_BLOCK" });
    } else if (stderr.includes("Private") || stderr.includes("not available") || stderr.includes("unavailable")) {
      return res.status(422).json({ error: "This video is private or unavailable." });
    } else if (stderr.includes("verify") || stderr.includes("not available on this app") || stderr.includes("No video formats found")) {
      return res.status(422).json({ error: "YouTube is blocking this video. Try a different video or add cookies in Settings." });
    } else if (stderr.includes("unsupported URL")) {
      return res.status(422).json({ error: "URL not supported. Please use a direct video link." });
    } else {
      return res.status(422).json({
        error: "Unable to fetch video info. The video may be private, age-restricted, or removed.",
      });
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/video/download  →  returns URL the frontend opens for download
// ─────────────────────────────────────────────────────────────────────────────
router.post("/download", async (req, res) => {
  const parsed = GetDownloadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request." });
    return;
  }

  const { url, formatId } = parsed.data;

  if (!isValidUrl(url)) {
    res.status(400).json({ error: "Invalid URL." });
    return;
  }

  // ── Instagram: video or audio download ───────────────────────────────────
  if (/instagram\.com\/(p|reel|tv)\//.test(url)) {
    try {
      const cached = getCached(url);
      let ig: InstagramData;
      if (cached) {
        ig = JSON.parse(cached);
      } else {
        ig = await instagramFetch(url);
        setCache(url, JSON.stringify(ig), CACHE_TTL_LONG_MS);
      }
      if (!ig.videoUrl) {
        res.status(422).json({ error: "Instagram video URL not available." });
        return;
      }
      if (formatId === "instagram:audio") {
        const streamUrl = `/api/video/stream?snap_cdn=${encodeURIComponent(ig.videoUrl)}&audio=true&bitrate=192`;
        res.json({ downloadUrl: streamUrl, filename: "instagram_audio.mp3" });
      } else {
        res.json({ downloadUrl: ig.videoUrl, filename: "instagram_video.mp4" });
      }
      return;
    } catch (err: any) {
      if (err?.code === "INSTAGRAM_COOKIES_REQUIRED") {
        res.status(422).json({
          error: "Instagram requires your session cookies to download videos.",
          errorCode: "INSTAGRAM_COOKIES_REQUIRED",
        });
      } else {
        res.status(422).json({ error: "Failed to get Instagram video. Make sure it's a public post or reel." });
      }
      return;
    }
  }

  // ── Snapchat: video or audio download ────────────────────────────────────
  if (/snapchat\.com\//.test(url)) {
    try {
      const cached = getCached(url);
      let snap: SnapchatData;
      if (cached) {
        snap = JSON.parse(cached);
      } else {
        snap = await snapchatFetch(url);
        setCache(url, JSON.stringify(snap), CACHE_TTL_LONG_MS);
      }
      if (!snap.videoUrl) {
        res.status(422).json({ error: "Snapchat video URL not available." });
        return;
      }
      if (formatId === "snapchat:audio") {
        // Extract audio from the CDN video stream via ffmpeg
        const streamUrl = `/api/video/stream?snap_cdn=${encodeURIComponent(snap.videoUrl)}&audio=true&bitrate=192`;
        res.json({ downloadUrl: streamUrl, filename: "snapchat_audio.mp3" });
      } else {
        res.json({ downloadUrl: snap.videoUrl, filename: "snapchat_video.mp4" });
      }
      return;
    } catch (err) {
      res.status(422).json({ error: "Failed to get Snapchat video. Make sure it's a public Spotlight video." });
      return;
    }
  }

  // ── TikTok: format IDs are "tiktok:hd", "tiktok:sd", "tiktok:audio"
  // We re-fetch from TikWM cache to get the direct CDN URL
  if (/tiktok\.com\//.test(url)) {
    try {
      const cached = getCached(url);
      let tk: TikWMData;
      if (cached) {
        tk = JSON.parse(cached);
      } else {
        tk = await tikwmFetch(url);
        setCache(url, JSON.stringify(tk), CACHE_TTL_LONG_MS);
      }
      let directUrl: string;
      let filename: string;
      if (formatId === "tiktok:hd") {
        directUrl = tk.hdplay || tk.play;
        filename = "tiktok_hd.mp4";
      } else if (formatId === "tiktok:sd") {
        directUrl = tk.play;
        filename = "tiktok.mp4";
      } else {
        directUrl = tk.music;
        filename = "tiktok_audio.mp3";
      }
      if (!directUrl) {
        res.status(422).json({ error: "TikTok download URL not available." });
        return;
      }
      res.json({ downloadUrl: directUrl, filename });
      return;
    } catch (err) {
      res.status(422).json({ error: "Failed to get TikTok download URL." });
      return;
    }
  }

  // Parse audio flag from formatId: "233:audio:320" or "bestaudio:audio:192"
  const parts = formatId.split(":");
  const isAudio = parts[1] === "audio";
  const actualFormatId = parts[0];
  const audioBitrate = parts[2] || "192";

  if (isAudio) {
    const streamUrl = `/api/video/stream?url=${encodeURIComponent(url)}&formatId=${encodeURIComponent(actualFormatId)}&audio=true&bitrate=${audioBitrate}`;
    res.json({ downloadUrl: streamUrl, filename: `audio_${audioBitrate}kbps.mp3` });
    return;
  }

  const isYtDownload = /youtube\.com\/|youtu\.be\//.test(url);

  // Virtual YouTube format IDs (yt_2160, yt_1080, etc.) — always use stream endpoint
  // yt-dlp resolves best available quality at download time via format selector
  if (isYtDownload && actualFormatId.startsWith("yt_")) {
    const height = actualFormatId.replace("yt_", "");
    const streamUrl = `/api/video/stream?url=${encodeURIComponent(url)}&formatId=${encodeURIComponent(actualFormatId)}&audio=false`;
    res.json({ downloadUrl: streamUrl, filename: `youtube_${height}p.mkv` });
    return;
  }

  // Helper: try --get-url with a specific client flag
  const tryGetUrl = async (clientFlag: string) => {
    const bin = getYtDlpBin();
    const xffFlag = isYtDownload ? getXffFlag() : "";
    const cmd = `"${bin}" -f "${actualFormatId}" --get-url --no-warnings --socket-timeout 10 ${clientFlag} ${xffFlag} "${url}"`;
    const { stdout } = await execAsync(cmd, { timeout: 35000 });
    const urls = stdout.trim().split("\n").filter(Boolean);
    if (!urls.length) throw new Error("No URLs");
    return urls;
  };

  try {
    let urls: string[] = [];

    if (isYtDownload) {
      // YouTube: smart client rotation — tries clients in health-ranked order
      const { result } = await withYtClientRotation((flag) => tryGetUrl(flag));
      urls = result;
    } else {
      urls = await tryGetUrl("--geo-bypass");
    }

    // Detect HLS manifests — cannot serve as direct CDN links
    const isHLS = (u: string) =>
      u.includes(".m3u8") ||
      u.includes("/manifest/") ||
      u.includes("manifest.googlevideo.com");

    if (urls.length === 1 && !isHLS(urls[0])) {
      // Direct CDN URL → return it (mp4 combined format, e.g. YouTube format 18)
      res.json({ downloadUrl: urls[0], filename: `video_${actualFormatId}.mp4` });
      return;
    }

    // HLS or multi-stream → use stream endpoint (ffmpeg merge → MKV)
    const streamUrl = `/api/video/stream?url=${encodeURIComponent(url)}&formatId=${encodeURIComponent(actualFormatId)}&audio=false`;
    res.json({ downloadUrl: streamUrl, filename: "video.mkv" });
  } catch {
    // Fallback to stream endpoint
    const streamUrl = `/api/video/stream?url=${encodeURIComponent(url)}&formatId=${encodeURIComponent(actualFormatId)}&audio=false`;
    res.json({ downloadUrl: streamUrl, filename: "video.mkv" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/video/stream  →  streams actual file bytes
// Video: ffmpeg merges video+audio → MKV (seekable, plays in all players)
// Audio: ffmpeg converts to MP3
// ─────────────────────────────────────────────────────────────────────────────
router.get("/stream", async (req, res) => {
  const { url, formatId, audio, bitrate, snap_cdn } = req.query as {
    url?: string;
    formatId?: string;
    audio?: string;
    bitrate?: string;
    snap_cdn?: string;
  };

  // ── Snapchat CDN audio extraction (direct ffmpeg, no yt-dlp needed) ─────
  if (snap_cdn) {
    const mp3Bitrate = bitrate || "192";
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Disposition", `attachment; filename="snapchat_audio.mp3"`);
    const ffmpeg = spawn("ffmpeg", [
      "-user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "-i", snap_cdn,
      "-vn", "-c:a", "libmp3lame",
      "-b:a", `${mp3Bitrate}k`,
      "-f", "mp3", "pipe:1",
    ]);
    ffmpeg.stdout.pipe(res);
    ffmpeg.stderr.on("data", (d: Buffer) => req.log?.info?.({ stderr: d.toString().slice(0, 100) }, "ffmpeg snap audio"));
    ffmpeg.on("error", (e: Error) => { if (!res.headersSent) res.status(500).end(); });
    req.on("close", () => ffmpeg.kill());
    return;
  }

  if (!url || !isValidUrl(url)) {
    res.status(400).json({ error: "Invalid URL." });
    return;
  }

  const isAudio = audio === "true";
  const mp3Bitrate = bitrate || "192";

  if (isAudio) {
    // ── AUDIO → MP3 ──────────────────────────────────────────────────────────
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="audio_${mp3Bitrate}kbps.mp3"`
    );

    const audioFmt =
      formatId === "bestaudio"
        ? "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio"
        : formatId;

    const isYtAudio = /youtube\.com\/|youtu\.be\//.test(url);

    if (isYtAudio) {
      // YouTube audio: use client rotation to get a direct CDN URL, then ffmpeg -vn extracts audio
      req.log.info("YouTube audio: client rotation → ffmpeg");
      try {
        const bin = getYtDlpBin();
        const { result: f18out } = await withYtClientRotation(async (flag) => {
          const { stdout } = await execAsync(
            `"${bin}" -f "18/bestaudio" --get-url --no-warnings --socket-timeout 10 ${flag} ${getXffFlag()} "${url}"`,
            { timeout: 25000 }
          );
          if (!stdout.trim()) throw new Error("empty");
          return stdout;
        });
        const f18url = f18out.trim().split("\n")[0];
        if (!f18url || f18url.includes(".m3u8") || f18url.includes("/manifest/")) {
          throw new Error("No direct URL");
        }
        const ffmpeg = spawn("ffmpeg", [
          "-i", f18url,
          "-vn", "-c:a", "libmp3lame",
          "-b:a", `${mp3Bitrate}k`,
          "-f", "mp3", "pipe:1",
        ]);
        ffmpeg.stdout.pipe(res);
        ffmpeg.stderr.on("data", (d: Buffer) =>
          req.log.info({ stderr: d.toString().slice(0, 150) }, "ffmpeg f18 audio")
        );
        ffmpeg.on("error", (e: Error) => {
          if (!res.headersSent) res.status(500).end();
          req.log.error({ err: e.message }, "ffmpeg audio error");
        });
        req.on("close", () => ffmpeg.kill());
      } catch (err) {
        req.log.error({ err: (err as Error).message }, "YouTube audio failed");
        if (!res.headersSent) res.status(500).json({ error: "Audio extraction failed. Try again." });
      }
    } else {
      // Non-YouTube: try direct CDN URL + ffmpeg (faster), fallback to yt-dlp pipe
      try {
        const cmd = `"${getYtDlpBin()}" -f "${audioFmt}" --get-url --no-warnings --socket-timeout 10 --geo-bypass --geo-bypass-country US "${url}"`;
        const { stdout } = await execAsync(cmd, { timeout: 35000 });
        const audioUrl = stdout.trim().split("\n")[0];
        // Reject HLS manifests (ffmpeg can't handle them without special auth)
        if (!audioUrl || audioUrl.includes(".m3u8") || audioUrl.includes("/manifest/")) {
          throw new Error("HLS or empty URL");
        }
        const ffmpeg = spawn("ffmpeg", [
          "-i", audioUrl,
          "-vn",
          "-c:a", "libmp3lame",
          "-b:a", `${mp3Bitrate}k`,
          "-f", "mp3",
          "pipe:1",
        ]);
        ffmpeg.stdout.pipe(res);
        ffmpeg.stderr.on("data", (d: Buffer) =>
          req.log.info({ stderr: d.toString().slice(0, 150) }, "ffmpeg audio")
        );
        ffmpeg.on("error", (e: Error) => {
          if (!res.headersSent) res.status(500).end();
          req.log.error({ err: e.message }, "ffmpeg audio error");
        });
        req.on("close", () => ffmpeg.kill());
      } catch (err) {
        req.log.warn({ err: (err as Error).message }, "Audio CDN fallback, piping yt-dlp");
        const ytdlp = spawn(getYtDlpBin(), [
          "-f", audioFmt,
          "-x", "--audio-format", "mp3",
          "--audio-quality", `${mp3Bitrate}K`,
          "--no-warnings",
          "--geo-bypass",
          "-o", "-",
          url,
        ]);
        ytdlp.stdout.pipe(res);
        ytdlp.stderr.on("data", (d: Buffer) =>
          req.log.info({ stderr: d.toString().slice(0, 150) }, "yt-dlp audio fallback")
        );
        ytdlp.on("error", (e: Error) => {
          if (!res.headersSent) res.status(500).end();
          req.log.error({ err: e.message }, "yt-dlp audio error");
        });
        req.on("close", () => ytdlp.kill());
      }
    }
    return;
  }

  // ── VIDEO → MKV (via yt-dlp pipe) ───────────────────────────────────────
  res.setHeader("Content-Type", "video/x-matroska");
  res.setHeader("Content-Disposition", `attachment; filename="video.mkv"`);

  const isYtStream = /youtube\.com\/|youtu\.be\//.test(url);

  const isHLS = (u: string) =>
    u.includes(".m3u8") || u.includes("/manifest/") || u.includes("manifest.googlevideo.com");

  if (isYtStream) {
    // ── YouTube: real-time ffmpeg pipe merge (no temp file) ───────────────
    // Strategy: get direct CDN URLs via --get-url, then pipe both streams
    // through ffmpeg for real-time merge → client receives response immediately
    // (no waiting for full download). Fallback to temp-file if --get-url fails.
    req.log.info({ formatId }, "YouTube stream: real-time ffmpeg pipe");

    // Map virtual yt_XXXX format IDs to proper yt-dlp format selectors
    const resolveYtFormat = (fid: string): string => {
      if (!fid.startsWith("yt_")) return `${fid}+bestaudio/${fid}/best`;
      const h = fid.replace("yt_", "");
      return `bestvideo[height<=${h}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${h}]+bestaudio/best[height<=${h}]/best`;
    };
    const resolvedFormat = resolveYtFormat(formatId ?? "");

    // Height label for filename
    const heightLabel = (fid: string) => fid.startsWith("yt_") ? fid.replace("yt_", "") + "p" : "video";
    const filename = `video_${heightLabel(formatId ?? "")}.mp4`;

    // ── Per-IP rate limit: prevent spam that flags our server IP ────────
    const clientIp = req.ip ?? req.socket?.remoteAddress ?? "unknown";
    if (!checkIpLimit(clientIp)) {
      res.status(429).json({ error: "Too many downloads. Please wait a few minutes and try again." });
      return;
    }

    await ytStreamSemaphore.acquire();
    const releaseSemaphore = () => { ytStreamSemaphore.release(); };
    req.on("close", releaseSemaphore);

    // ── Step 1: Get CDN URLs (cache first, then fetch) ───────────────────
    // Cache key = video URL + format selector — same video+quality = same URLs
    const cdnCacheKey = `${url}::${resolvedFormat}`;
    let cdnUrls: string[] = getCachedCdnUrls(cdnCacheKey) ?? [];
    let fromCache = cdnUrls.length > 0;

    if (!fromCache) {
      // In-flight dedup: if another request is already fetching these URLs, wait for it
      let fetchPromise = ytStreamInFlight.get(cdnCacheKey);
      if (!fetchPromise) {
        fetchPromise = (async (): Promise<string[]> => {
          const getUrlClients = ["android_embedded", "android_testsuite", "android_music", "tv_embedded"] as const;
          await ytRateLimiter.acquire(); // cap server-wide YouTube calls
          for (const client of getUrlClients) {
            try {
              const { stdout: urlOut } = await execAsync(
                `"${getYtDlpBin()}" -f "${resolvedFormat}" --get-url --no-warnings --socket-timeout 10 --no-check-formats ${getYtExtractorArgs(client)} ${getXffFlag()} "${url}"`,
                { timeout: 30000 }
              );
              const urls = urlOut.trim().split("\n").filter(Boolean);
              if (urls.length > 0) {
                req.log.info({ client, urlCount: urls.length }, "CDN URLs fetched");
                setCachedCdnUrls(cdnCacheKey, urls); // cache for next request
                return urls;
              }
            } catch (e) {
              req.log.warn({ client, err: (e as Error).message?.slice(0, 100) }, "get-url client failed");
            }
          }
          return [];
        })();
        ytStreamInFlight.set(cdnCacheKey, fetchPromise);
        fetchPromise.finally(() => ytStreamInFlight.delete(cdnCacheKey));
      }
      cdnUrls = await fetchPromise;
    } else {
      req.log.info({ cdnCacheKey }, "CDN URLs served from cache (no YouTube hit)");
    }

    if (cdnUrls.length === 0) {
      releaseSemaphore();
      req.removeAllListeners("close");
      if (!res.headersSent) res.status(502).json({ error: "Could not fetch video URL from YouTube" });
      return;
    }

    releaseSemaphore();
    req.removeAllListeners("close");

    // ── Step 2: Pipe through ffmpeg for real-time merge ─────────────────
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    // CDN URLs (googlevideo.com) are pre-signed — no special headers needed.
    // Adding incorrect/extra headers can trigger CDN rejection. Keep it clean.
    let ffmpegArgs: string[];
    const ffmpegBase = [
      "-y", "-loglevel", "warning",
      "-f", "mp4",
      "-movflags", "frag_keyframe+empty_moov+default_base_moof",
      "pipe:1",
    ];
    if (cdnUrls.length >= 2) {
      // Two DASH streams: video + audio → merge
      ffmpegArgs = ["-y", "-loglevel", "warning", "-i", cdnUrls[0], "-i", cdnUrls[1],
        "-c:v", "copy", "-c:a", "copy",
        "-f", "mp4", "-movflags", "frag_keyframe+empty_moov+default_base_moof", "pipe:1"];
    } else {
      // Single stream: remux to fragmented mp4
      ffmpegArgs = ["-y", "-loglevel", "warning", "-i", cdnUrls[0],
        "-c", "copy",
        "-f", "mp4", "-movflags", "frag_keyframe+empty_moov+default_base_moof", "pipe:1"];
    }

    const ffmpegBin = "ffmpeg";
    const ffmpegProc = spawn(ffmpegBin, ffmpegArgs, { stdio: ["ignore", "pipe", "pipe"] });

    ffmpegProc.stderr.on("data", (d: Buffer) =>
      req.log.info({ stderr: d.toString().slice(0, 300) }, "ffmpeg")
    );
    ffmpegProc.stdout.pipe(res);
    ffmpegProc.on("close", (code) => {
      req.log.info({ code }, "ffmpeg done");
      if (!res.writableEnded) res.end();
    });
    ffmpegProc.on("error", (e: Error) => {
      req.log.error({ err: e.message }, "ffmpeg error");
      if (!res.headersSent) res.status(500).json({ error: "ffmpeg error" });
    });
    req.on("close", () => { ffmpegProc.kill("SIGKILL"); });
    return;
  }

  // ── Non-YouTube: try --get-url + ffmpeg, fallback to yt-dlp pipe ────────
  try {
    const fmtSelector = `${formatId}+bestaudio/${formatId}/best`;
    const { stdout } = await execAsync(
      `"${getYtDlpBin()}" -f "${fmtSelector}" --get-url --no-warnings --socket-timeout 10 --geo-bypass --geo-bypass-country US "${url}"`,
      { timeout: 35000 }
    );
    const cdnUrls = stdout.trim().split("\n").filter(Boolean);
    const hasHLS = cdnUrls.some(isHLS);

    if (hasHLS || cdnUrls.length === 0) throw new Error("HLS or no CDN URLs");

    if (cdnUrls.length >= 2) {
      const [vidUrl, audUrl] = cdnUrls;
      const ffmpeg = spawn("ffmpeg", [
        "-i", vidUrl, "-i", audUrl,
        "-c:v", "copy", "-c:a", "aac",
        "-f", "matroska", "pipe:1",
      ]);
      ffmpeg.stdout.pipe(res);
      ffmpeg.stderr.on("data", (d: Buffer) =>
        req.log.info({ stderr: d.toString().slice(0, 150) }, "ffmpeg merge")
      );
      ffmpeg.on("error", (e: Error) => {
        req.log.error({ err: e.message }, "ffmpeg merge error");
        if (!res.headersSent) res.status(500).end();
      });
      req.on("close", () => ffmpeg.kill());
    } else {
      const ffmpeg = spawn("ffmpeg", [
        "-i", cdnUrls[0],
        "-c:v", "copy", "-c:a", "copy",
        "-f", "matroska", "pipe:1",
      ]);
      ffmpeg.stdout.pipe(res);
      ffmpeg.stderr.on("data", (d: Buffer) =>
        req.log.info({ stderr: d.toString().slice(0, 150) }, "ffmpeg remux")
      );
      ffmpeg.on("error", (e: Error) => {
        req.log.error({ err: e.message }, "ffmpeg remux error");
        if (!res.headersSent) res.status(500).end();
      });
      req.on("close", () => ffmpeg.kill());
    }
  } catch (err) {
    req.log.warn({ err: (err as Error).message }, "CDN fetch failed, piping yt-dlp");
    const pipeArgs = [
      "-f", `${formatId}/best`,
      "--merge-output-format", "mkv",
      "--no-warnings",
      "--geo-bypass",
      "-o", "-",
      url,
    ];
    const ytdlp = spawn(getYtDlpBin(), pipeArgs);
    ytdlp.stdout.pipe(res);
    ytdlp.stderr.on("data", (d: Buffer) =>
      req.log.info({ stderr: d.toString().slice(0, 150) }, "yt-dlp stream fallback")
    );
    ytdlp.on("error", (e: Error) => {
      if (!res.headersSent) res.status(500).end();
      req.log.error({ err: e.message }, "yt-dlp stream error");
    });
    req.on("close", () => ytdlp.kill());
  }
});

// ── Thumbnail proxy (cross-origin display + download fix) ────────────────────
// Supports ?download=true to force Content-Disposition attachment
router.get("/thumbnail", async (req, res) => {
  const url = String(req.query.url || "").trim();
  const isDownload = req.query.download === "true";
  if (!url || !/^https?:\/\//.test(url)) {
    return res.status(400).json({ error: "Invalid URL" });
  }
  try {
    const isInstagram = url.includes("instagram") || url.includes("cdninstagram") || url.includes("fbcdn");
    const headers: Record<string, string> = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    };
    if (isInstagram) {
      headers["Referer"] = "https://www.instagram.com/";
      headers["Origin"] = "https://www.instagram.com";
    }
    const response = await fetch(url, { headers });
    if (!response.ok) {
      // Return a transparent 1×1 PNG so <img> onError fires properly
      const transparentPng = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        "base64"
      );
      res.setHeader("Content-Type", "image/png");
      res.setHeader("X-Thumb-Error", `upstream ${response.status}`);
      return res.status(200).send(transparentPng);
    }
    const contentType = response.headers.get("content-type") || "image/jpeg";
    // Reject non-image responses (e.g. HTML error pages)
    if (!contentType.startsWith("image/")) {
      const transparentPng = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        "base64"
      );
      res.setHeader("Content-Type", "image/png");
      res.setHeader("X-Thumb-Error", "non-image content-type");
      return res.status(200).send(transparentPng);
    }
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=3600");
    if (isDownload) {
      res.setHeader("Content-Disposition", 'attachment; filename="thumbnail.jpg"');
    }
    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch {
    const transparentPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64"
    );
    res.setHeader("Content-Type", "image/png");
    res.status(200).send(transparentPng);
  }
});

export default router;
