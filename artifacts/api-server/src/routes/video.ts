import { Router } from "express";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import { existsSync, statSync, createReadStream, unlink } from "fs";
import { GetVideoInfoBody, GetDownloadUrlBody } from "@workspace/api-zod";

const execAsync = promisify(exec);
const router = Router();

// ── yt-dlp binary: prefer the workspace-local updated binary ──────────────────
const YTDLP_BIN = (() => {
  const candidates = [
    "/home/runner/workspace/bin/yt-dlp-latest",
    "/home/runner/workspace/bin/yt-dlp-2026",
  ];
  return candidates.find(existsSync) ?? "yt-dlp";
})();

const PLATFORM_PATTERNS: Record<string, RegExp[]> = {
  YouTube: [/youtube\.com\/watch/, /youtu\.be\//, /youtube\.com\/shorts\//],
  TikTok: [/tiktok\.com\//],
  Instagram: [/instagram\.com\/(reel|p|stories|tv)\//],
  Facebook: [/facebook\.com\//, /fb\.watch\//],
  Snapchat: [/snapchat\.com\/spotlight\//],
  "Twitter/X": [/twitter\.com\//, /x\.com\//],
};

function detectPlatform(url: string): string {
  for (const [platform, patterns] of Object.entries(PLATFORM_PATTERNS)) {
    if (patterns.some((p) => p.test(url))) return platform;
  }
  return "Unknown";
}

/** Base flags always applied to every yt-dlp call */
const BASE_FLAGS = "--no-playlist --no-warnings --socket-timeout 20 --no-check-formats";

/** YouTube clients: android is fastest, web gives best quality */
const YT_ANDROID_FLAG = '--extractor-args "youtube:player_client=android"';
const YT_WEB_FALLBACKS = [
  "",  // default web client
  '--extractor-args "youtube:player_client=ios"',
  '--extractor-args "youtube:player_client=tv_embedded"',
];

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
      error:
        "Unsupported platform. We support YouTube, TikTok, Instagram, Facebook, Snapchat and Twitter/X.",
    });
    return;
  }

  const isYouTube = platform === "YouTube";

  const runInfo = async (extraFlags = ""): Promise<string> => {
    const cmd = `"${YTDLP_BIN}" --dump-json ${BASE_FLAGS} ${extraFlags} "${url}"`;
    const { stdout } = await execAsync(cmd, { timeout: 35000 });
    return stdout;
  };

  try {
    // ── Check cache first ────────────────────────────────────────────────────
    let stdout: string;
    const cached = getCached(url);
    if (cached) {
      req.log.info("cache hit");
      stdout = cached;
    } else if (isYouTube) {
      // ── YouTube HD extraction strategy (mid-2026) ─────────────────────────
      // Default client (no extractor-args): returns 720p/1080p/4K as HLS m3u8.
      // Android client: returns format 18 (360p combined mp4) quickly — reliable fallback.
      // We run both in parallel and pick whichever has HD (720p+) first.
      // KEY BUG FIX: never re-race an already-resolved promise — it returns immediately
      // with the stale result, preventing the HD client from being awaited.

      const tryClient = async (flag: string) => {
        const out = await runInfo(flag);
        if (!out.trim()) throw new Error("empty output");
        const info: YtDlpInfo = JSON.parse(out.trim().split("\n")[0]);
        const fmtCount = (info.formats || []).filter(
          (f) => f.height && f.height >= 720 && f.vcodec !== "none"
        ).length;
        return { stdout: out, fmtCount };
      };

      // Helper: promise that only resolves if fmtCount > 0 (HD quality), otherwise never resolves
      const hdOnly = (p: Promise<{ stdout: string; fmtCount: number } | null>) =>
        new Promise<{ stdout: string; fmtCount: number }>((resolve, reject) =>
          p.then((r) => (r && r.fmtCount > 0 ? resolve(r) : reject(new Error("no HD")))).catch(reject)
        );

      // Start both clients simultaneously (android fast, default has HD)
      const defaultP = tryClient("").catch(() => null);                   // 720p/1080p HLS
      const androidP = tryClient(YT_ANDROID_FLAG).catch(() => null);     // 360p mp4 (fast)

      let bestResult: { stdout: string; fmtCount: number } | null = null;

      // Wait up to 20s for first HD result
      const hdResult = await Promise.race([
        hdOnly(defaultP),
        hdOnly(androidP),
        new Promise<null>((r) => setTimeout(() => r(null), 20000)),
      ]).catch(() => null);

      if (hdResult) {
        bestResult = hdResult;
        req.log.info({ fmtCount: hdResult.fmtCount }, "YouTube HD result");
      } else {
        // No HD — use android 360p fallback (already settled or settle now)
        const [def, and] = await Promise.all([defaultP, androidP]);
        bestResult = and ?? def;
        req.log.warn("YouTube: no HD formats, using 360p fallback");
      }

      if (!bestResult) throw new AggregateError([], "All YouTube clients failed");
      stdout = bestResult.stdout;
      setCache(url, stdout);
    } else {
      stdout = await withRetry(() => runInfo());
      setCache(url, stdout);
    }

    const firstLine = stdout.trim().split("\n")[0];
    const info: YtDlpInfo = JSON.parse(firstLine);
    const formats = buildFormats(info.formats);

    // ── YouTube HD injection ───────────────────────────────────────────────
    // Default yt-dlp client returns 720p/1080p as HLS m3u8 (format 232/270),
    // but info extraction sometimes only gets 360p (android client fallback).
    // We inject virtual HD options: at download time the stream endpoint uses
    // the default client (web) which reliably gets HLS 720p/1080p.
    if (isYouTube) {
      const videoFmts = formats.filter((f) => f.type === "video");
      const hasHD = videoFmts.some((f) => {
        const h = parseInt(f.quality);
        return !isNaN(h) && h >= 720;
      });
      if (!hasHD) {
        // Insert HD options before 360p in the video formats list
        const insertIdx = formats.findIndex((f) => f.type === "video");
        const hdOptions = [
          { formatId: "270", quality: "1080p", label: "1080p Full HD", type: "video" as const, filesize: null, badge: "Full HD" },
          { formatId: "232", quality: "720p", label: "720p HD", type: "video" as const, filesize: null, badge: "HD" },
        ];
        if (insertIdx >= 0) {
          formats.splice(insertIdx, 0, ...hdOptions);
        } else {
          formats.unshift(...hdOptions);
        }
      }
    }

    res.json({
      url,
      title: info.title || "Unknown Video",
      thumbnail: info.thumbnail || null,
      duration: info.duration || null,
      platform,
      formats,
    });
  } catch (err) {
    // Promise.any() throws AggregateError when ALL clients fail — collect all stderr messages
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
    req.log.error({ err: stderr }, "yt-dlp info failed");

    if (stderr.includes("Sign in") || stderr.includes("log in") || stderr.includes("login")) {
      res.status(422).json({ error: "This video requires login and cannot be downloaded." });
    } else if (stderr.includes("Private") || stderr.includes("not available") || stderr.includes("unavailable")) {
      res.status(422).json({ error: "This video is private or unavailable." });
    } else if (stderr.includes("bot") || stderr.includes("verify") || stderr.includes("not available on this app") || stderr.includes("No video formats found")) {
      res.status(422).json({ error: "YouTube is blocking this video from server access. Try a different video." });
    } else if (stderr.includes("unsupported URL")) {
      res.status(422).json({ error: "URL not supported. Please use a direct video link." });
    } else if (platform === "TikTok") {
      res.status(422).json({
        error: "TikTok restricts access from server IPs. Try a direct TikTok link or another platform.",
      });
    } else {
      res.status(422).json({
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
    const cmd = `"${YTDLP_BIN}" -f "${actualFormatId}" --get-url --no-warnings --socket-timeout 20 ${clientFlag} "${url}"`;
    const { stdout } = await execAsync(cmd, { timeout: 35000 });
    const urls = stdout.trim().split("\n").filter(Boolean);
    if (!urls.length) throw new Error("No URLs");
    return urls;
  };

  try {
    let urls: string[] = [];

    if (isYtDownload) {
      // YouTube: try android first (works for combined/restricted formats like 18)
      // then fall back to default web client (for web-client formats like 137, 248)
      try {
        urls = await tryGetUrl('--extractor-args "youtube:player_client=android"');
      } catch {
        urls = await tryGetUrl("");
      }
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
      // YouTube audio (mid-2026): ios/tv_embedded/web all blocked for audio-only from server IPs.
      // Only reliable path: android client → format 18 (360p combined mp4, no PO token needed)
      // → ffmpeg -vn extracts audio only. Output size = duration × bitrate (correct behaviour).
      req.log.info("YouTube audio: format 18 → ffmpeg");
      try {
        const { stdout: f18out } = await execAsync(
          `"${YTDLP_BIN}" -f "18" --get-url --no-warnings --socket-timeout 20 --extractor-args "youtube:player_client=android" "${url}"`,
          { timeout: 25000 }
        );
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
        const cmd = `"${YTDLP_BIN}" -f "${audioFmt}" --get-url --no-warnings --socket-timeout 20 --geo-bypass "${url}"`;
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
        const ytdlp = spawn(YTDLP_BIN, [
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
        const proc = spawn(YTDLP_BIN, args);
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

    // Try web client first (720p/1080p/4K), android fallback (360p combined mp4)
    let tmpFile = await runDownload(buildArgs([]), "yt-dlp web download");
    if (!tmpFile) {
      req.log.warn("Web client failed, trying android fallback");
      tmpFile = await runDownload(
        buildArgs(["--extractor-args", "youtube:player_client=android"]),
        "yt-dlp android download"
      );
    }
    streamTempFile(tmpFile ?? `${tmpBase}.mkv`);
    return;
  }

  // ── Non-YouTube: try --get-url + ffmpeg, fallback to yt-dlp pipe ────────
  try {
    const fmtSelector = `${formatId}+bestaudio/${formatId}/best`;
    const { stdout } = await execAsync(
      `"${YTDLP_BIN}" -f "${fmtSelector}" --get-url --no-warnings --socket-timeout 20 --geo-bypass "${url}"`,
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
    const ytdlp = spawn(YTDLP_BIN, pipeArgs);
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
