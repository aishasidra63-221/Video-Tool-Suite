import { Router } from "express";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import { existsSync, statSync, createReadStream, unlink } from "fs";
import https from "https";
import { GetVideoInfoBody, GetDownloadUrlBody } from "@workspace/api-zod";
import { getYtDlpBin, withYtClientRotation, hasCookies, getCookiesFlag } from "../lib/ytdlp-manager";

const execAsync = promisify(exec);
const router = Router();

const PLATFORM_PATTERNS: Record<string, RegExp[]> = {
  YouTube: [/youtube\.com\/watch/, /youtu\.be\//, /youtube\.com\/shorts\//],
  TikTok: [/tiktok\.com\//],
  Snapchat: [/snapchat\.com/],
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

  // Extract __NEXT_DATA__ JSON
  const match = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/);
  if (!match) throw new Error("Snapchat: page data not found — make sure it is a public Spotlight URL");

  let nextData: unknown;
  try { nextData = JSON.parse(match[1]); }
  catch { throw new Error("Snapchat: failed to parse page data"); }

  // ── Snapchat CDN facts (confirmed by testing) ──────────────────────────────
  // Video streams:    bolt-gcdn.sc-cdn.net  with  .27.  in path
  // Thumbnails:       bolt-gcdn.sc-cdn.net  with  .256. in path
  //                   cf-st.sc-cdn.net      (static images)
  // ────────────────────────────────────────────────────────────────────────────
  const boltUrls = deepFindStrings(nextData, (s) => s.includes("bolt-gcdn.sc-cdn.net"));
  const videoUrls = boltUrls.filter((u) => u.includes(".27."));
  const thumbBoltUrls = boltUrls.filter((u) => u.includes(".256."));
  const cfstUrls = deepFindStrings(nextData, (s) => s.includes("cf-st.sc-cdn.net"));

  if (!videoUrls.length) {
    throw new Error("Snapchat: no video found — the video may be private, deleted, or not a Spotlight video");
  }

  // Title from og:title meta tag
  const titleMatch = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/);
  const title = titleMatch ? titleMatch[1].replace(/\s*\|\s*Snapchat\s*$/, "").trim() : "Snapchat Video";

  // Thumbnail: prefer bolt .256. urls, fallback to cf-st
  const thumbnail = thumbBoltUrls[0] || cfstUrls[0] || null;

  return {
    title,
    thumbnail,
    videoUrl: videoUrls[0],
    duration: null,
  };
}

function detectPlatform(url: string): string {
  for (const [platform, patterns] of Object.entries(PLATFORM_PATTERNS)) {
    if (patterns.some((p) => p.test(url))) return platform;
  }
  return "Unknown";
}

/** Base flags always applied to every yt-dlp call */
const BASE_FLAGS = "--no-playlist --no-warnings --socket-timeout 20 --no-check-formats";

// ── Simple in-memory cache (5 min TTL) ────────────────────────────────────
interface CacheEntry { data: string; expiresAt: number; }
const infoCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function getCached(key: string): string | null {
  const entry = infoCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { infoCache.delete(key); return null; }
  return entry.data;
}
function setCache(key: string, data: string) {
  infoCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  // Prevent unbounded growth
  if (infoCache.size > 200) {
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
async function withRetry<T>(fn: () => Promise<T>, retries = 2, delayMs = 1500): Promise<T> {
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

  const runInfo = async (clientFlag = "", extraFlags = ""): Promise<string> => {
    const bin = getYtDlpBin();
    const cmd = `"${bin}" --dump-json ${BASE_FLAGS} ${clientFlag} ${extraFlags} "${url}"`;
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
        setCache(url, JSON.stringify(tk));
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
        setCache(url, JSON.stringify(snap));
      }
      return res.json({
        url,
        title: snap.title || "Snapchat Video",
        thumbnail: snap.thumbnail || null,
        duration: snap.duration || null,
        platform,
        formats: [
          { formatId: "snapchat:video", quality: "HD", label: "Video (MP4)", type: "video", filesize: null, badge: "HD" },
        ],
      });
    }

    // ── Check cache first ────────────────────────────────────────────────────
    let stdout: string;
    const cached = getCached(url);
    if (cached) {
      req.log.info("cache hit");
      stdout = cached;
    } else if (isYouTube) {
      // ── YouTube: smart client rotation ────────────────────────────────────
      let out: string;
      try {
        const { result } = await withYtClientRotation((flag) => runInfo(flag));
        out = result;
      } catch (firstErr) {
        const errMsg = ((firstErr as Error & { stderr?: string }).stderr || (firstErr as Error).message || "");
        const isBotBlock = errMsg.toLowerCase().includes("sign in") || errMsg.toLowerCase().includes("bot");
        if (isBotBlock && hasCookies()) {
          req.log.info("Bot block detected, retrying with cookies");
          const cookiesFlag = getCookiesFlag();
          const { result } = await withYtClientRotation((flag) => runInfo(flag, cookiesFlag));
          out = result;
        } else {
          throw firstErr;
        }
      }
      stdout = out;
      setCache(url, stdout);
    } else {
      stdout = await withRetry(() => runInfo());
      setCache(url, stdout);
    }

    const firstLine = stdout.trim().split("\n")[0];
    const info: YtDlpInfo = JSON.parse(firstLine);
    const formats = buildFormats(info.formats);

    res.json({
      url,
      title: info.title || "Unknown Video",
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

  // ── Snapchat: re-fetch from cache or scrape again
  if (/snapchat\.com\//.test(url)) {
    try {
      const cached = getCached(url);
      let snap: SnapchatData;
      if (cached) {
        snap = JSON.parse(cached);
      } else {
        snap = await snapchatFetch(url);
        setCache(url, JSON.stringify(snap));
      }
      if (!snap.videoUrl) {
        res.status(422).json({ error: "Snapchat video URL not available." });
        return;
      }
      res.json({ downloadUrl: snap.videoUrl, filename: "snapchat_video.mp4" });
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
        setCache(url, JSON.stringify(tk));
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

  // Helper: try --get-url with a specific client flag
  const tryGetUrl = async (clientFlag: string) => {
    const bin = getYtDlpBin();
    const cmd = `"${bin}" -f "${actualFormatId}" --get-url --no-warnings --socket-timeout 20 ${clientFlag} "${url}"`;
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
  const { url, formatId, audio, bitrate } = req.query as {
    url: string;
    formatId: string;
    audio: string;
    bitrate?: string;
  };

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
            `"${bin}" -f "18/bestaudio" --get-url --no-warnings --socket-timeout 20 ${flag} "${url}"`,
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
        const cmd = `"${getYtDlpBin()}" -f "${audioFmt}" --get-url --no-warnings --socket-timeout 20 --geo-bypass "${url}"`;
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
    // ── YouTube: download to temp file → stream → cleanup ─────────────────
    // YouTube HLS streams (720p/1080p/4K) cannot be piped to stdout directly —
    // yt-dlp needs to write video+audio temp files, merge via ffmpeg, then output.
    // We download to /tmp, stream the merged MKV, then delete.
    // --postprocessor-args "merger:-allowed_extensions ALL" fixes YouTube HLS audio merge.
    req.log.info({ formatId }, "YouTube stream: temp file download");

    const tmpId = `vt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const tmpBase = `/tmp/${tmpId}`;

    const streamTempFile = (tmpFile: string) => {
      if (!existsSync(tmpFile)) {
        if (!res.headersSent) res.status(500).json({ error: "Download failed" });
        return;
      }
      const stat = statSync(tmpFile);
      res.setHeader("Content-Length", stat.size);
      const fileStream = createReadStream(tmpFile);
      fileStream.pipe(res);
      const cleanup = () => unlink(tmpFile, () => {});
      fileStream.on("close", cleanup);
      req.on("close", () => { fileStream.destroy(); cleanup(); });
    };

    const buildArgs = (extraArgs: string[]) => [
      "-f", `${formatId}+bestaudio/${formatId}/best`,
      "--merge-output-format", "mkv",
      "--no-warnings", "--socket-timeout", "20", "--no-check-formats",
      "--postprocessor-args", "merger:-allowed_extensions ALL",
      ...extraArgs,
      "-o", `${tmpBase}.%(ext)s`,
      url,
    ];

    const runDownload = (args: string[], label: string): Promise<string | null> =>
      new Promise((resolve) => {
        const proc = spawn(getYtDlpBin(), args);
        proc.stderr.on("data", (d: Buffer) =>
          req.log.info({ stderr: d.toString().slice(0, 200) }, label)
        );
        proc.on("close", (code) => {
          const outFile = `${tmpBase}.mkv`;
          resolve(code === 0 && existsSync(outFile) ? outFile : null);
        });
        proc.on("error", () => resolve(null));
        req.on("close", () => proc.kill());
      });

    // Client rotation: tries android,ios → ios → android → mweb in health-ranked order
    const clients = ["android,ios", "ios", "android", "mweb"] as const;
    let tmpFile: string | null = null;
    for (const client of clients) {
      tmpFile = await runDownload(
        buildArgs(["--extractor-args", `youtube:player_client=${client}`]),
        `yt-dlp ${client} download`
      );
      if (tmpFile) { req.log.info({ client }, "YouTube download succeeded"); break; }
      req.log.warn({ client }, "Download client failed, trying next");
    }
    streamTempFile(tmpFile ?? `${tmpBase}.mkv`);
    return;
  }

  // ── Non-YouTube: try --get-url + ffmpeg, fallback to yt-dlp pipe ────────
  try {
    const fmtSelector = `${formatId}+bestaudio/${formatId}/best`;
    const { stdout } = await execAsync(
      `"${getYtDlpBin()}" -f "${fmtSelector}" --get-url --no-warnings --socket-timeout 20 --geo-bypass "${url}"`,
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

// ── Thumbnail proxy (cross-origin download fix) ───────────────────────────────
router.get("/thumbnail", async (req, res) => {
  const url = String(req.query.url || "").trim();
  if (!url || !/^https?:\/\//.test(url)) {
    return res.status(400).json({ error: "Invalid URL" });
  }
  try {
    const response = await fetch(url);
    if (!response.ok) return res.status(502).json({ error: "Failed to fetch thumbnail" });
    const contentType = response.headers.get("content-type") || "image/jpeg";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", 'attachment; filename="thumbnail.jpg"');
    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch {
    res.status(500).json({ error: "Thumbnail download failed" });
  }
});

export default router;
