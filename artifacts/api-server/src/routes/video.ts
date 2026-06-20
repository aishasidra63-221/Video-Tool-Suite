import { Router } from "express";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import { existsSync, statSync, createReadStream, unlink } from "fs";
import https from "https";
import { GetVideoInfoBody, GetDownloadUrlBody } from "@workspace/api-zod";
import { getYtDlpBin, withYtClientRotation, withYtClientRotationFast, hasCookies, getCookiesFlag, hasInstagramCookies, getInstagramCookiesFlag, getXffFlag, getBrowserHeaderFlags, getYtExtractorArgs, ytRateLimiter, twitterRateLimiter } from "../lib/ytdlp-manager";

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

// ── Concurrency Semaphore ─────────────────────────────────────────────────────
// Bounded queue with per-request timeout. When maxQueue is full or timeoutMs
// elapses, acquire() rejects with code="SERVER_BUSY" so we can return 503
// immediately instead of making users wait minutes for a slot.
class Semaphore {
  private slots: number;
  private readonly maxQueue: number;
  private queue: Array<{ resolve: () => void; reject: (e: Error) => void; timer?: ReturnType<typeof setTimeout> }> = [];

  constructor(slots: number, maxQueue = 200) {
    this.slots = slots;
    this.maxQueue = maxQueue;
  }

  acquire(timeoutMs?: number): Promise<void> {
    if (this.slots > 0) { this.slots--; return Promise.resolve(); }
    // Queue full → reject immediately so the caller gets 503 right away
    if (this.queue.length >= this.maxQueue) {
      return Promise.reject(Object.assign(new Error("Server busy"), { code: "SERVER_BUSY" }));
    }
    return new Promise<void>((resolve, reject) => {
      const entry = { resolve, reject, timer: undefined as ReturnType<typeof setTimeout> | undefined };
      if (timeoutMs) {
        entry.timer = setTimeout(() => {
          const idx = this.queue.indexOf(entry);
          if (idx >= 0) this.queue.splice(idx, 1);
          reject(Object.assign(new Error("Server busy (timeout)"), { code: "SERVER_BUSY" }));
        }, timeoutMs);
      }
      this.queue.push(entry);
    });
  }

  release(): void {
    const entry = this.queue.shift();
    if (entry) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.resolve(); // slot transfers to first waiter — count unchanged
    } else {
      this.slots++;
    }
  }

  /** How many requests are currently waiting for a slot */
  get queueDepth(): number { return this.queue.length; }
  /** How many slots are currently in use */
  get activeCount(): number { return (this as any)._totalSlots - this.slots; }
}

const igSemaphore = new Semaphore(4, 20);  // 4 concurrent, max 20 waiting
const snapSemaphore = new Semaphore(2, 10); // 2 concurrent — limits Snapchat rate-limiting risk

// ── YouTube concurrency semaphore ─────────────────────────────────────────────
// Caps simultaneous yt-dlp calls. maxQueue = burst buffer — beyond this we
// return 503 immediately rather than silently queue everyone for minutes.
const ytInfoSemaphore   = new Semaphore(4, 30); // 4 concurrent, max 30 queued
const ytStreamSemaphore = new Semaphore(3, 20); // 3 concurrent, max 20 queued

// ── In-flight deduplication (same URL → share one fetch) ─────────────────────
// Prevents N concurrent users hitting the same URL from making N requests
const igInFlight = new Map<string, Promise<InstagramData>>();
const ytInFlight = new Map<string, Promise<string>>(); // YouTube info deduplication
const twInFlight = new Map<string, Promise<string>>(); // Twitter info deduplication

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
  Snapchat: [/snapchat\.com/, /story\.snapchat\.com/],
  Instagram: [/instagram\.com\/(p|reel|tv)\//],
  Twitter: [/twitter\.com\/\w+\/status\/\d+/, /x\.com\/\w+\/status\/\d+/, /t\.co\//],
};

// ── TikTok URL Normalizer ─────────────────────────────────────────────────────
// Strips tracking params and ensures a clean URL is sent to TikWM.
// Handles multiple TikTok Android share URL formats:
//   1. Full video URL:  /@user/video/123456789?_t=abc  →  /@user/video/123456789
//   2. aweme_id param:  /@user?aweme_id=123456789      →  /@user/video/123456789
//   3. item_id param:   /?item_id=123456789             →  /@user/video/123456789 (passed raw to TikWM)
//   4. Short URL:       vm.tiktok.com/XXXX             →  follow redirect
function normalizeTikTokUrl(rawUrl: string): Promise<string> {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(rawUrl);

      if (parsed.hostname === "www.tiktok.com" || parsed.hostname === "tiktok.com") {
        // Case 1: path already has video ID  →  strip tracking params
        if (/\/video\/\d+/.test(parsed.pathname)) {
          resolve(`https://www.tiktok.com${parsed.pathname}`);
          return;
        }

        // Case 2: aweme_id / item_id / video_id in query param
        // e.g. https://www.tiktok.com/@user?aweme_id=7123456789
        const awemeId = parsed.searchParams.get("aweme_id") ||
                        parsed.searchParams.get("item_id") ||
                        parsed.searchParams.get("video_id");
        if (awemeId && /^\d+$/.test(awemeId)) {
          const userMatch = parsed.pathname.match(/^\/@([^/]+)/);
          if (userMatch) {
            resolve(`https://www.tiktok.com/@${userMatch[1]}/video/${awemeId}`);
          } else {
            resolve(`https://www.tiktok.com/video/${awemeId}`);
          }
          return;
        }

        // Case 3: _t share-token URL  →  follow redirect to get actual video URL
        // e.g. https://www.tiktok.com/@user?_t=ZS-97LW&_r=1
        // TikTok server redirects this to the actual /@user/video/ID URL
        const tToken = parsed.searchParams.get("_t");
        if (tToken) {
          const redirectReq = https.request({
            hostname: "www.tiktok.com",
            path: parsed.pathname + parsed.search,
            method: "GET",
            headers: {
              "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 TikTok/28.0.0",
              "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
              "Accept-Language": "en-US,en;q=0.9",
            },
          }, (redirectRes) => {
            const location = redirectRes.headers["location"] as string | undefined;
            if (location && location.includes("/video/")) {
              try {
                const loc = new URL(location.startsWith("http") ? location : "https://www.tiktok.com" + location);
                resolve(`https://www.tiktok.com${loc.pathname}`);
              } catch {
                resolve(location);
              }
            } else {
              // No redirect — pass raw URL
              resolve(rawUrl);
            }
          });
          redirectReq.on("error", () => resolve(rawUrl));
          redirectReq.setTimeout(8000, () => { redirectReq.destroy(); resolve(rawUrl); });
          redirectReq.end();
          return;
        }

        // Case 4: unknown format — pass raw URL to TikWM, keep sec_uid for context
        const keepParams = ["sec_uid", "user_id", "aweme_id", "item_id"];
        const kept = new URLSearchParams();
        for (const key of keepParams) {
          const val = parsed.searchParams.get(key);
          if (val) kept.set(key, val);
        }
        const keptStr = kept.toString();
        resolve(`https://www.tiktok.com${parsed.pathname}${keptStr ? "?" + keptStr : ""}`);
        return;
      }

      // Short URL (vt.tiktok.com, vm.tiktok.com, m.tiktok.com) — follow redirect
      const reqOpts = {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: "HEAD",
        headers: {
          "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 TikTok/28.0.0",
          "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      };
      const req = https.request(reqOpts, (res) => {
        const location = res.headers["location"] as string | undefined;
        if (location && location.includes("tiktok.com") && location.includes("/video/")) {
          try {
            const loc = new URL(location);
            resolve(`https://www.tiktok.com${loc.pathname}`);
          } catch {
            resolve(location);
          }
        } else {
          resolve(rawUrl);
        }
      });
      req.on("error", () => resolve(rawUrl));
      req.setTimeout(8000, () => { req.destroy(); resolve(rawUrl); });
      req.end();
    } catch {
      resolve(rawUrl);
    }
  });
}

// ── TikWM API Fetch ───────────────────────────────────────────────────────────
// tikwm.com is the primary and most reliable free TikTok API.
// Rotation: randomised UA + Accept-Language per request to avoid fingerprinting.
// Jitter: 150–600ms random delay before each call so we don't look like a bot.
// Retry: up to 2 automatic retries with exponential backoff on transient failures.

const TIKWM_UAS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
];

const TIKWM_ACCEPT_LANGS = [
  "en-US,en;q=0.9",
  "en-GB,en;q=0.9",
  "en-US,en;q=0.8,fr;q=0.5",
  "de-DE,de;q=0.9,en;q=0.8",
  "pt-BR,pt;q=0.9,en;q=0.8",
  "ja-JP,ja;q=0.9,en;q=0.7",
  "es-ES,es;q=0.9,en;q=0.8",
];

function randomTikwmUA(): string { return TIKWM_UAS[Math.floor(Math.random() * TIKWM_UAS.length)]; }
function randomTikwmLang(): string { return TIKWM_ACCEPT_LANGS[Math.floor(Math.random() * TIKWM_ACCEPT_LANGS.length)]; }
function tikwmJitter(): Promise<void> {
  const ms = 150 + Math.floor(Math.random() * 450); // 150–600ms
  return new Promise((r) => setTimeout(r, ms));
}

function tikwmFetchOnce(videoUrl: string): Promise<TikWMData> {
  return new Promise((resolve, reject) => {
    const body = `url=${encodeURIComponent(videoUrl)}&hd=1`;
    const req = https.request({
      hostname: "www.tikwm.com",
      path: "/api/",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
        "User-Agent": randomTikwmUA(),
        "Referer": "https://www.tikwm.com/",
        "Origin": "https://www.tikwm.com",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": randomTikwmLang(),
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "cors",
      },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (json.code !== 0) {
            reject(new Error(`TikWM error: ${json.msg || "unknown"} (code ${json.code})`));
          } else if (!json.data || typeof json.data !== "object") {
            reject(new Error("TikWM: empty data in response"));
          } else {
            resolve(json.data as TikWMData);
          }
        } catch {
          reject(new Error("TikWM: invalid JSON response"));
        }
      });
    });
    req.on("error", (e) => reject(new Error(`TikWM request failed: ${e.message}`)));
    req.setTimeout(15000, () => { req.destroy(); reject(new Error("TikWM: request timeout")); });
    req.write(body);
    req.end();
  });
}

// Public function — jitter + up to 2 retries with 800ms/1600ms backoff
async function tikwmFetch(videoUrl: string): Promise<TikWMData> {
  const TIKWM_PERMANENT_ERRORS = ["does not exist", "not found", "deleted", "private"];
  const maxAttempts = 3;
  let lastErr: Error = new Error("TikWM: all attempts failed");
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await tikwmJitter();
    try {
      return await tikwmFetchOnce(videoUrl);
    } catch (err: any) {
      lastErr = err;
      const msg: string = (err.message || "").toLowerCase();
      // Don't retry permanent errors (video deleted, private, etc.)
      if (TIKWM_PERMANENT_ERRORS.some((s) => msg.includes(s))) throw err;
      if (attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }
  }
  throw lastErr;
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

// Normalize Snapchat URLs: story.snapchat.com → www.snapchat.com
function normalizeSnapchatUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "story.snapchat.com") {
      return `https://www.snapchat.com${parsed.pathname}${parsed.search}`;
    }
    return url;
  } catch {
    return url;
  }
}

// Snapchat-specific User-Agents — desktop browsers most trusted by Snapchat CDN
const SNAP_USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
];
function randomSnapUA(): string {
  return SNAP_USER_AGENTS[Math.floor(Math.random() * SNAP_USER_AGENTS.length)];
}

// Returns { html, status } — callers can check status to decide whether to retry
function snapHttpGet(url: string, ua: string, maxRedirects = 8): Promise<{ html: string; status: number }> {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error("Snapchat: too many redirects"));
    let parsed: URL;
    try { parsed = new URL(url); } catch { return reject(new Error("Snapchat: invalid URL")); }
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: "GET",
      headers: {
        "User-Agent": ua,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        // Force English — prevents localized og:title strings
        "Accept-Language": "en-US,en;q=1.0",
        "Accept-Encoding": "identity",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Referer": "https://www.google.com/",
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "cross-site",
        "Upgrade-Insecure-Requests": "1",
      },
    }, (res) => {
      const status = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
        const loc = res.headers.location.startsWith("http")
          ? res.headers.location
          : "https://www.snapchat.com" + res.headers.location;
        snapHttpGet(loc, ua, maxRedirects - 1).then(resolve).catch(reject);
        return;
      }
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ html: data, status }));
    });
    req.on("error", reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error("Snapchat fetch timeout")); });
    req.end();
  });
}

// Detect bot-block pages (Cloudflare, CAPTCHA, JS challenge, etc.)
function isSnapBotBlock(html: string, status: number): boolean {
  if (status === 403 || status === 429) return true;
  if (html.length < 800) return true; // suspiciously short — likely a block page
  const lower = html.toLowerCase();
  return (
    lower.includes("captcha") ||
    lower.includes("cf-browser-verification") ||
    lower.includes("just a moment") ||
    lower.includes("checking your browser") ||
    lower.includes("enable javascript and cookies") ||
    lower.includes("ddos-guard") ||
    lower.includes("access denied") ||
    (lower.includes("403") && !lower.includes("og:video"))
  );
}

// Small delay helper for retry backoff
function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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

// Core fetch attempt with a specific UA — returns parsed data or throws
async function snapchatFetchAttempt(videoUrl: string, ua: string): Promise<SnapchatData> {
  const { html, status } = await snapHttpGet(videoUrl, ua);
  if (isSnapBotBlock(html, status)) {
    throw Object.assign(new Error(`Snapchat bot-block (status ${status})`), { botBlock: true });
  }
  return parseSnapchatHtml(html, videoUrl);
}

// Parse HTML into SnapchatData (extracted so retry loop can call it without re-fetching)
function parseSnapchatHtml(html: string, videoUrl: string): SnapchatData {

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
  // og:title format (English): "{N} likes | {ACTUAL TITLE} | @user | Posted ... | Snapchat"
  // When localized (e.g. Hindi), the title may just be stats with no pipe separators.
  // og:description is often more reliable for the actual caption text.
  const titleMatch = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/) ||
    html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:title"/);
  const descMatch = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/) ||
    html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:description"/);

  let title = "Snapchat Video";
  let uploader: string | null = null;

  if (titleMatch) {
    const raw = titleMatch[1];
    const parts = raw.split(/\s*\|\s*/);

    // ── Part classifiers ────────────────────────────────────────────────────
    // Stats part: ANY part that STARTS with a digit (like counts, share counts, etc.)
    // Covers English ("53.4K likes") and localized ("53.4ह. लाइक्स") forms.
    const isStatsPart = (s: string) => /^\d/.test(s.trim());

    // Date/posted part: localized date strings also often start with a digit (day number)
    // Handled by isStatsPart above. Additional: "Posted ...", "X जून 2026 को पोस्ट"
    const isDatePart = (s: string) => /^posted/i.test(s.trim());

    // Platform suffix: "Snapchat", "Spotlight", "स्पॉटलाइट"
    const isPlatformPart = (s: string) => /^snapchat$/i.test(s.trim()) || /^spotlight/i.test(s.trim()) || /^स्पॉटलाइट/.test(s.trim());

    // Extract @username — look for (@handle) pattern inside any part
    // Covers: "@christie" as standalone OR "Christie Anne (@christieemc)" embedded
    for (const p of parts) {
      const embedded = p.match(/\(@?(\w+)\)/);
      if (embedded) { uploader = embedded[1]; break; }
      if (p.trim().startsWith("@")) { uploader = p.trim().replace(/^@/, ""); break; }
    }

    // Caption = parts that are NOT stats, date, platform, or @user-only
    const captionParts = parts.filter((p) => {
      const t = p.trim();
      if (!t) return false;
      if (isStatsPart(t)) return false;
      if (isDatePart(t)) return false;
      if (isPlatformPart(t)) return false;
      // Skip pure username parts
      if (t.startsWith("@")) return false;
      // Skip "Name (@handle)" — it's the author, not caption
      if (/^[^#]+\(@?\w+\)$/.test(t) && !t.includes("#")) return false;
      return true;
    });

    if (captionParts.length > 0) {
      title = captionParts[0].trim();
    } else if (descMatch) {
      const desc = descMatch[1].replace(/\s*\|\s*Snapchat\s*$/, "").trim();
      if (desc && desc.length > 3) title = desc;
    }
  } else if (descMatch) {
    const desc = descMatch[1].replace(/\s*\|\s*Snapchat\s*$/, "").trim();
    if (desc && desc.length > 3) title = desc;
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

// ── snapchatFetch: retries up to 3 times with different UAs on bot-block ─────
async function snapchatFetch(rawUrl: string): Promise<SnapchatData> {
  const videoUrl = normalizeSnapchatUrl(rawUrl);
  const maxAttempts = 3;
  // Shuffle UA list so each attempt uses a fresh random one (no repeats)
  const shuffled = [...SNAP_USER_AGENTS].sort(() => Math.random() - 0.5);
  let lastError: Error = new Error("Snapchat: all retry attempts failed");

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const ua = shuffled[attempt % shuffled.length];
    try {
      return await snapchatFetchAttempt(videoUrl, ua);
    } catch (err: any) {
      lastError = err;
      // Only retry on bot-block errors; propagate real errors immediately
      if (!err.botBlock) throw err;
      // Wait before next retry: 800ms, 1600ms
      if (attempt < maxAttempts - 1) await delay(800 * (attempt + 1));
    }
  }
  throw lastError;
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

  // ── Layer 3: yt-dlp (primary video extractor) ────────────────────────────────
  if (!videoUrl_) {
    const bin = getYtDlpBin();
    try {
      const cmd = `"${bin}" --dump-json --no-playlist --no-warnings --socket-timeout 10 "${videoUrl}"`;
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
    } catch { /* ignore */ }
  }

  if (!videoUrl_) {
    throw new Error("Instagram: video nahi mila — post private ya delete ho sakti hai.");
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

  const { url, mediaType } = parsed.data;

  if (!isValidUrl(url)) {
    res.status(400).json({ error: "Invalid URL format." });
    return;
  }

  const platform = detectPlatform(url);
  if (platform === "Unknown") {
    res.status(400).json({
      error: "Unsupported platform. We support YouTube, TikTok, Twitter/X, Instagram, and Snapchat.",
    });
    return;
  }

  const isYouTube = platform === "YouTube";
  const isTikTok = platform === "TikTok";
  const isSnapchat = platform === "Snapchat";
  const isInstagram = platform === "Instagram";
  const isTwitter = platform === "Twitter";

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
      // Normalize URL first (follows redirects for vm/m/vt short links, extracts aweme_id)
      const cleanUrl = await normalizeTikTokUrl(url);
      req.log.info({ original: url, clean: cleanUrl }, "TikTok URL normalized");

      // If no /video/ID after normalization, still try TikWM — it may resolve the URL.
      // Only if TikWM also fails do we return the "profile URL" error.
      const hasVideoId = /\/video\/\d+/.test(cleanUrl);
      req.log.info({ hasVideoId, cleanUrl }, "TikTok video ID check");

      const cacheKey = cleanUrl;
      const cached = getCached(cacheKey);
      let tk: TikWMData;
      if (cached) {
        req.log.info("cache hit (tiktok)");
        tk = JSON.parse(cached);
      } else {
        tk = await tikwmFetch(cleanUrl);
        setCache(cacheKey, JSON.stringify(tk), CACHE_TTL_LONG_MS);
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
        platform,
        formats: mediaType ? formats.filter(f => f.type === mediaType) : formats,
      });
    }

    // ── Snapchat: scrape with UA rotation + retry on bot-block ───────────────
    if (isSnapchat) {
      const cached = getCached(url);
      let snap: SnapchatData;
      if (cached) {
        req.log.info("cache hit (snapchat)");
        snap = JSON.parse(cached);
      } else {
        await snapSemaphore.acquire(25000);
        try {
          snap = await snapchatFetch(url);
          setCache(url, JSON.stringify(snap), CACHE_TTL_LONG_MS);
        } finally {
          snapSemaphore.release();
        }
      }
      const snapFormats = [
        { formatId: "snapchat:video",    quality: "HD",  label: "HD Video (Original)", type: "video" as const, filesize: null, badge: "HD" },
        { formatId: "snapchat:video_sd", quality: "480p", label: "Compressed (480p) • Small File", type: "video" as const, filesize: null, badge: "Light" },
        { formatId: "snapchat:audio",    quality: "MP3", label: "Audio Only (MP3)",    type: "audio" as const, filesize: null, badge: null },
      ];
      return res.json({
        url,
        title: snap.title || "Snapchat Video",
        uploader: snap.uploader || null,
        thumbnail: snap.thumbnail || null,
        duration: snap.duration || null,
        platform,
        formats: mediaType ? snapFormats.filter(f => f.type === mediaType) : snapFormats,
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

    // ── Twitter / X: yt-dlp guest-token extractor + XFF anti-detection ───────
    if (isTwitter) {
      try {
      // t.co short URLs: follow redirect to get real twitter.com URL
      let twitterUrl = url;
      if (/t\.co\//.test(url)) {
        try {
          const { stdout: resolved } = await execAsync(
            `curl -sI --max-redirs 5 -o /dev/null -w "%{url_effective}" "${url}"`,
            { timeout: 8000 }
          );
          if (resolved && resolved.trim()) twitterUrl = resolved.trim();
        } catch { /* use original URL */ }
      }

      const cached = getCached(twitterUrl);
      let twInfo: any;
      if (cached) {
        req.log.info("cache hit (twitter)");
        twInfo = JSON.parse(cached);
      } else {
        // Rate-limit Twitter API calls (prevents guest-token exhaustion)
        await twitterRateLimiter.acquire();

        const existing = twInFlight.get(twitterUrl);
        if (existing) {
          req.log.info("twitter in-flight dedup hit");
          twInfo = JSON.parse(await existing);
        } else {
          const fetchPromise = (async (): Promise<string> => {
            const bin = getYtDlpBin();
            const xffFlag = getXffFlag(); // rotate X-Forwarded-For across 14 countries
            const cmd = `"${bin}" --dump-json --no-playlist --no-warnings --socket-timeout 20 ${xffFlag} "${twitterUrl}"`;
            const { stdout } = await execAsync(cmd, { timeout: 35000 });
            return stdout.trim().split('\n')[0]; // first JSON line only
          })();
          twInFlight.set(twitterUrl, fetchPromise);
          try {
            const raw = await fetchPromise;
            twInfo = JSON.parse(raw);
            setCache(twitterUrl, raw, CACHE_TTL_LONG_MS);
          } catch (ytErr: any) {
            twInFlight.delete(twitterUrl);
            const errMsg: string = ytErr?.stderr || ytErr?.message || "";
            if (errMsg.includes("No video could be found")) {
              return res.status(422).json({
                error: "Is tweet mein koi video nahi hai. Sirf video wale tweets ka link paste karo.",
                errorCode: "TWITTER_NO_VIDEO",
              });
            }
            if (errMsg.includes("does not exist") || errMsg.includes("404")) {
              return res.status(422).json({
                error: "Ye tweet nahi mila — ho sakta hai delete ho gaya ho ya private ho.",
                errorCode: "TWITTER_NOT_FOUND",
              });
            }
            throw ytErr; // re-throw for generic handler
          } finally {
            twInFlight.delete(twitterUrl);
          }
        }
      }

      // Parse video formats — Twitter typically has 720p / 480p / 360p variants
      const videoFormats: Array<{ formatId: string; quality: string; label: string; type: "video"; filesize: null; badge: string | null }> = [];
      const seenHeights = new Set<number>();

      const rawFormats: any[] = twInfo.formats || [];
      // Sort by height descending, then bitrate descending
      const vidFmts = rawFormats
        .filter((f: any) => f.ext === "mp4" && f.height && f.vcodec !== "none" && f.url)
        .sort((a: any, b: any) => (b.height - a.height) || ((b.tbr || 0) - (a.tbr || 0)));

      for (const f of vidFmts) {
        const h: number = f.height;
        if (seenHeights.has(h)) continue;
        seenHeights.add(h);
        const isFirst = videoFormats.length === 0;
        videoFormats.push({
          formatId: `twitter:${h}`,
          quality: h >= 720 ? "HD" : h >= 480 ? "SD" : "Low",
          label: `Video ${h}p${h >= 720 ? " (Best)" : ""}`,
          type: "video" as const,
          filesize: null,
          badge: isFirst ? (h >= 720 ? "HD" : "Best") : null,
        });
      }

      if (videoFormats.length === 0) {
        return res.status(422).json({
          error: "Is tweet mein koi video nahi mila. Sirf video tweets ka link paste karo.",
          errorCode: "TWITTER_NO_VIDEO",
        });
      }

      // Always offer audio extraction
      videoFormats.push({
        formatId: "twitter:audio",
        quality: "MP3",
        label: "Audio Only (MP3)",
        type: "audio" as any,
        filesize: null,
        badge: null,
      });

      return res.json({
        url: twitterUrl,
        title: twInfo.title || twInfo.description || "Twitter Video",
        uploader: twInfo.uploader || twInfo.uploader_id || null,
        thumbnail: twInfo.thumbnail || null,
        duration: twInfo.duration || null,
        platform,
        formats: mediaType ? videoFormats.filter(f => f.type === mediaType) : videoFormats,
      });
      } catch (twitterErr: any) {
        const errMsg: string = twitterErr?.stderr || twitterErr?.message || "";
        if (errMsg.includes("No video could be found")) {
          return res.status(422).json({
            error: "Is tweet mein koi video nahi hai. Sirf video wale tweets ka link paste karo.",
            errorCode: "TWITTER_NO_VIDEO",
          });
        }
        if (errMsg.includes("does not exist") || errMsg.includes("404")) {
          return res.status(422).json({
            error: "Ye tweet nahi mila — ho sakta hai delete ho gaya ho ya private ho.",
            errorCode: "TWITTER_NOT_FOUND",
          });
        }
        req.log.error({ err: twitterErr }, "Twitter fetch error");
        return res.status(422).json({
          error: "Twitter video nahi mila. Dobara try karo ya check karo ke tweet public ho.",
        });
      }
    }

    // ── Check cache first ────────────────────────────────────────────────────
    let stdout: string;
    const cached = getCached(url);
    if (cached) {
      req.log.info("cache hit");
      stdout = cached;
    } else if (isYouTube) {
      // ── YouTube: in-flight dedup + bounded semaphore + client rotation ────
      // Same URL from N concurrent users → 1 yt-dlp call, rest await same promise.
      // If queue is full (>30 waiting) or wait >25 s → immediate 503, not hang.
      const existing = ytInFlight.get(url);
      if (existing) {
        req.log.info("YouTube in-flight dedup hit");
        stdout = await existing;
      } else {
        const fetchPromise = (async (): Promise<string> => {
          // Acquire with 25 s timeout; throws {code:"SERVER_BUSY"} if queue full or elapsed
          await ytInfoSemaphore.acquire(25_000);
          try {
            await ytRateLimiter.acquire(); // global 20/min cap
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
        })().catch(err => {
          ytInFlight.delete(url); // always clean up, even on acquire failure
          throw err;
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
    const allFormats = isYouTube
      ? [
          { formatId: "yt_1440", quality: "1440p", label: "1440p QHD",     type: "video" as const, filesize: estSize(8000),  badge: "QHD" },
          { formatId: "yt_1080", quality: "1080p", label: "1080p Full HD", type: "video" as const, filesize: estSize(4000),  badge: "Full HD" },
          { formatId: "yt_720",  quality: "720p",  label: "720p HD",       type: "video" as const, filesize: estSize(2500),  badge: "HD" },
          { formatId: "bestaudio:audio:192", quality: "192kbps", label: "MP3 ~192kbps • High Quality", type: "audio" as const, filesize: estSize(192), badge: "Best Quality" },
          { formatId: "bestaudio:audio:128", quality: "128kbps", label: "MP3 ~128kbps • Standard",     type: "audio" as const, filesize: estSize(128), badge: null },
        ]
      : buildFormats(info.formats);

    const filteredFormats = mediaType
      ? allFormats.filter(f => f.type === mediaType)
      : allFormats;

    res.json({
      url,
      title: info.title || "Unknown Video",
      uploader: (info as any).uploader || (info as any).uploader_id || (info as any).channel || null,
      thumbnail: info.thumbnail || null,
      duration: info.duration || null,
      platform,
      formats: filteredFormats,
    });
  } catch (err) {
    // ── SERVER_BUSY: queue full or per-request timeout hit ───────────────────
    if ((err as any)?.code === "SERVER_BUSY") {
      return res.status(503).json({
        error: "Server busy hai — bahut saare log ek saath hain. Thodi der (10-15 sec) baad dobara try karo. ⏳",
        errorCode: "SERVER_BUSY",
      });
    }

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
      // If we never found a video ID, this was a profile/account URL, not a video URL
      const cleanedForCheck = url.replace(/[?&].*/,"");
      const looksLikeProfile = !/\/video\/\d+/.test(cleanedForCheck) &&
                               !/aweme_id=\d+/.test(url) &&
                               !/item_id=\d+/.test(url);
      if (looksLikeProfile) {
        return res.status(422).json({
          error: "Ye TikTok profile/account URL lag raha hai — kisi specific VIDEO ka link chahiye. TikTok mein video open karo → share icon → 'Copy Link' → woh link yahan paste karo.",
          errorCode: "TIKTOK_PROFILE_URL",
        });
      }
      const hint = stderr.toLowerCase().includes("rate") || stderr.toLowerCase().includes("429")
        ? "TikTok rate limit. 2-3 second baad dobara try karo."
        : "TikTok video load nahi hua. URL check karo aur dobara try karo.";
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

  // ── Twitter / X: yt-dlp CDN URL → proxy through server ──────────────────
  if (/twitter\.com\/\w+\/status\/\d+|x\.com\/\w+\/status\/\d+/.test(url)) {
    try {
      const isAudioReq = formatId === "twitter:audio";
      const heightStr = formatId.replace("twitter:", "");
      const height = parseInt(heightStr, 10);

      // Build yt-dlp format selector
      let fmtSelector: string;
      if (isAudioReq) {
        fmtSelector = "bestaudio/best";
      } else if (!isNaN(height)) {
        fmtSelector = `best[height<=${height}][ext=mp4]/best[height<=${height}]/best[ext=mp4]/best`;
      } else {
        fmtSelector = "best[ext=mp4]/best";
      }

      // CDN URL cache key
      const cdnKey = `twitter:${url}:${formatId}`;
      const cachedCdn = getCachedCdnUrls(cdnKey);
      let cdnUrl: string;

      if (cachedCdn && cachedCdn[0]) {
        cdnUrl = cachedCdn[0];
      } else {
        // Rate-limit Twitter CDN URL fetches
        await twitterRateLimiter.acquire();
        const bin = getYtDlpBin();
        const xffFlag = getXffFlag();
        const { stdout } = await execAsync(
          `"${bin}" --get-url --no-playlist --no-warnings --socket-timeout 20 -f "${fmtSelector}" ${xffFlag} "${url}"`,
          { timeout: 35000 }
        );
        cdnUrl = stdout.trim().split("\n")[0];
        if (!cdnUrl) throw new Error("No CDN URL returned");
        setCachedCdnUrls(cdnKey, [cdnUrl]);
      }

      if (isAudioReq) {
        // Extract audio via ffmpeg on the server
        const streamUrl = `/api/video/stream?snap_cdn=${encodeURIComponent(cdnUrl)}&audio=true&bitrate=192`;
        res.json({ downloadUrl: streamUrl, filename: "twitter_audio.mp3" });
      } else {
        // Proxy video — Twitter CDN (video.twimg.com) needs server-side fetch
        const streamUrl = `/api/video/stream?cdn_proxy=${encodeURIComponent(cdnUrl)}&cdn_filename=${encodeURIComponent("twitter_video.mp4")}`;
        res.json({ downloadUrl: streamUrl, filename: "twitter_video.mp4" });
      }
      return;
    } catch (err: any) {
      const msg = err?.message || "";
      if (msg.includes("No video")) {
        res.status(422).json({ error: "Is tweet mein video nahi mila." });
      } else {
        res.status(422).json({ error: "Twitter video download nahi ho saka. Dobara try karo." });
      }
      return;
    }
  }

  // ── Snapchat: video or audio download ────────────────────────────────────
  if (/snapchat\.com\//.test(url) || /story\.snapchat\.com/.test(url)) {
    try {
      const normalizedSnapUrl = normalizeSnapchatUrl(url);
      const cacheKey = normalizedSnapUrl;
      const cached = getCached(cacheKey);
      let snap: SnapchatData;
      if (cached) {
        snap = JSON.parse(cached);
      } else {
        await snapSemaphore.acquire(25000);
        try {
          snap = await snapchatFetch(normalizedSnapUrl);
          setCache(cacheKey, JSON.stringify(snap), CACHE_TTL_LONG_MS);
        } finally {
          snapSemaphore.release();
        }
      }
      if (!snap.videoUrl) {
        res.status(422).json({ error: "Snapchat video URL not available." });
        return;
      }
      if (formatId === "snapchat:audio") {
        // Extract audio from CDN video stream via ffmpeg
        const streamUrl = `/api/video/stream?snap_cdn=${encodeURIComponent(snap.videoUrl)}&audio=true&bitrate=192`;
        res.json({ downloadUrl: streamUrl, filename: "snapchat_audio.mp3" });
      } else if (formatId === "snapchat:video_sd") {
        // Compressed 480p: ffmpeg re-encodes the CDN video to smaller file
        const streamUrl = `/api/video/stream?snap_cdn=${encodeURIComponent(snap.videoUrl)}&scale=480`;
        res.json({ downloadUrl: streamUrl, filename: "snapchat_480p.mp4" });
      } else {
        // HD original: proxy Snapchat CDN response as-is (fastest, no CPU)
        const streamUrl = `/api/video/stream?snap_cdn=${encodeURIComponent(snap.videoUrl)}`;
        res.json({ downloadUrl: streamUrl, filename: "snapchat_hd.mp4" });
      }
      return;
    } catch (err) {
      res.status(422).json({ error: "Failed to get Snapchat video. Make sure it's a public Spotlight video URL." });
      return;
    }
  }

  // ── TikTok: format IDs are "tiktok:hd", "tiktok:sd", "tiktok:audio"
  // We re-fetch from TikWM cache to get the direct CDN URL
  if (/tiktok\.com\//.test(url)) {
    try {
      const cleanUrl = await normalizeTikTokUrl(url);
      const cacheKey = cleanUrl;
      const cached = getCached(cacheKey);
      let tk: TikWMData;
      if (cached) {
        tk = JSON.parse(cached);
      } else {
        tk = await tikwmFetch(cleanUrl);
        setCache(cacheKey, JSON.stringify(tk), CACHE_TTL_LONG_MS);
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
      // ── CDN URL strategy ──────────────────────────────────────────────────
      // TikWM returns its OWN proxy URLs (tikwm.com domain) — these are browser-accessible
      // without special headers, so give them directly to the user (zero server load).
      // If TikWM ever returns a raw TikTok CDN URL (v16/v19-webapp.tiktok.com), that
      // requires Referer spoofing — fall back to our cdn_proxy for that case only.
      let downloadUrl: string;
      try {
        const cdnHost = new URL(directUrl).hostname;
        const needsProxy = !cdnHost.includes("tikwm.com");
        if (needsProxy) {
          downloadUrl = `/api/video/stream?cdn_proxy=${encodeURIComponent(directUrl)}&cdn_filename=${encodeURIComponent(filename)}`;
          req.log.info({ cdnHost }, "TikTok CDN needs proxy");
        } else {
          // tikwm.com URL — browser can access directly, no server bandwidth used
          downloadUrl = directUrl;
          req.log.info({ cdnHost }, "TikTok CDN direct link (no proxy needed)");
        }
      } catch {
        // URL parse failed — safe fallback to proxy
        downloadUrl = `/api/video/stream?cdn_proxy=${encodeURIComponent(directUrl)}&cdn_filename=${encodeURIComponent(filename)}`;
      }
      res.json({ downloadUrl, filename });
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
  const { url, formatId, audio, bitrate, snap_cdn, cdn_proxy, cdn_filename, scale } = req.query as {
    url?: string;
    formatId?: string;
    audio?: string;
    bitrate?: string;
    snap_cdn?: string;
    scale?: string;
    cdn_proxy?: string;
    cdn_filename?: string;
  };

  // ── Generic CDN proxy — fetches URL server-side with spoofed headers ─────
  // Used for TikTok (CDN blocks direct browser access without Referer/UA)
  if (cdn_proxy) {
    try {
      const cdnUrl = decodeURIComponent(cdn_proxy);
      const parsed = new URL(cdnUrl);
      const isTikTok = parsed.hostname.includes("tiktok");
      const reqHeaders: Record<string, string> = {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
        "Accept": "*/*",
        "Accept-Encoding": "identity",
      };
      if (isTikTok) {
        reqHeaders["Referer"] = "https://www.tiktok.com/";
        reqHeaders["Origin"] = "https://www.tiktok.com";
      }
      const filename = cdn_filename ? decodeURIComponent(cdn_filename) : "download.mp4";
      const isAudioFile = filename.endsWith(".mp3") || filename.endsWith(".m4a");
      const upstream = https.request({
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: "GET",
        headers: reqHeaders,
      }, (upstream_res) => {
        const ct = upstream_res.headers["content-type"] || (isAudioFile ? "audio/mpeg" : "video/mp4");
        res.setHeader("Content-Type", ct);
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        if (upstream_res.headers["content-length"]) {
          res.setHeader("Content-Length", upstream_res.headers["content-length"]);
        }
        upstream_res.pipe(res);
      });
      upstream.on("error", (e) => {
        req.log?.warn?.({ err: e.message }, "cdn_proxy error");
        if (!res.headersSent) res.status(502).json({ error: "CDN fetch failed." });
      });
      upstream.setTimeout(20000, () => { upstream.destroy(); });
      req.on("close", () => upstream.destroy());
      upstream.end();
    } catch (e) {
      res.status(400).json({ error: "Invalid cdn_proxy URL." });
    }
    return;
  }

  // ── Snapchat CDN proxy (video passthrough, compressed re-encode, or audio) ─
  if (snap_cdn) {
    const isSnapAudio = audio === "true";
    const scaleHeight = scale ? parseInt(scale, 10) : null; // e.g. 480

    if (isSnapAudio) {
      // Audio: extract mp3 via ffmpeg from CDN stream
      const mp3Bitrate = bitrate || "192";
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Content-Disposition", `attachment; filename="snapchat_audio.mp3"`);
      const ffmpeg = spawn("ffmpeg", [
        "-user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "-headers", "Referer: https://www.snapchat.com/\r\nOrigin: https://www.snapchat.com",
        "-i", snap_cdn,
        "-vn", "-c:a", "libmp3lame",
        "-b:a", `${mp3Bitrate}k`,
        "-f", "mp3", "pipe:1",
      ]);
      ffmpeg.stdout.pipe(res);
      ffmpeg.stderr.on("data", (d: Buffer) => req.log?.info?.({ stderr: d.toString().slice(0, 100) }, "ffmpeg snap audio"));
      ffmpeg.on("error", () => { if (!res.headersSent) res.status(500).end(); });
      req.on("close", () => ffmpeg.kill());

    } else if (scaleHeight) {
      // Compressed video: ffmpeg re-encodes at target height (e.g. 480p)
      // -2:480 keeps aspect ratio (portrait Snaps are 9:16, so width auto-computed)
      // libx264 + aac gives excellent compatibility at ~1/3 the original file size
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Content-Disposition", `attachment; filename="snapchat_${scaleHeight}p.mp4"`);
      const ffmpeg = spawn("ffmpeg", [
        "-user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "-headers", "Referer: https://www.snapchat.com/\r\nOrigin: https://www.snapchat.com",
        "-i", snap_cdn,
        "-vf", `scale=-2:${scaleHeight}`,   // auto-width, target height
        "-c:v", "libx264",
        "-preset", "fast",                  // fast encode, reasonable quality
        "-crf", "26",                       // quality: 26 = ~60% size vs original
        "-c:a", "aac", "-b:a", "96k",
        "-movflags", "frag_keyframe+empty_moov", // streamable MP4
        "-f", "mp4", "pipe:1",
      ]);
      ffmpeg.stdout.pipe(res);
      ffmpeg.stderr.on("data", (d: Buffer) => req.log?.info?.({ stderr: d.toString().slice(0, 100) }, "ffmpeg snap compress"));
      ffmpeg.on("error", () => { if (!res.headersSent) res.status(500).end(); });
      req.on("close", () => ffmpeg.kill());

    } else {
      // HD original: proxy Snapchat CDN response through server as-is (fastest)
      let parsed: URL;
      try { parsed = new URL(snap_cdn); } catch { res.status(400).json({ error: "Invalid snap_cdn URL." }); return; }
      const snapReq = https.request({
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Referer": "https://www.snapchat.com/",
          "Origin": "https://www.snapchat.com",
          "Accept": "video/mp4,video/*,*/*",
        },
      }, (upstream) => {
        res.setHeader("Content-Type", upstream.headers["content-type"] || "video/mp4");
        res.setHeader("Content-Disposition", `attachment; filename="snapchat_hd.mp4"`);
        if (upstream.headers["content-length"]) res.setHeader("Content-Length", upstream.headers["content-length"]);
        upstream.pipe(res);
      });
      snapReq.on("error", () => { if (!res.headersSent) res.status(500).end(); });
      snapReq.setTimeout(30000, () => { snapReq.destroy(); });
      req.on("close", () => snapReq.destroy());
      snapReq.end();
    }
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

    // Bounded queue: max 20 waiting + 20s timeout → reject with SERVER_BUSY if overloaded
    try {
      await ytStreamSemaphore.acquire(20_000);
    } catch (busyErr: any) {
      if (busyErr?.code === "SERVER_BUSY") {
        res.status(503).json({ error: "Server busy — thodi der baad dobara try karo. ⏳", errorCode: "SERVER_BUSY" });
        return;
      }
      throw busyErr;
    }
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
