import { Router } from "express";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import https from "https";
import http from "http";
import { GetVideoInfoBody, GetDownloadUrlBody } from "@workspace/api-zod";

const execAsync = promisify(exec);
const router = Router();

const PLATFORM_PATTERNS: Record<string, RegExp[]> = {
  YouTube: [/youtube\.com\/watch/, /youtu\.be\//, /youtube\.com\/shorts\//],
  TikTok: [/tiktok\.com\//],
  Instagram: [/instagram\.com\/(reel|p|stories)\//],
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

  // ──────────────────────────────────
  // VIDEO FORMATS
  // Include any format that has a height, even if vcodec is null/unknown
  // (Instagram combined formats have vcodec=null but valid height)
  // Exclude explicit audio-only (vcodec='none') and mhtml thumbnails
  // ──────────────────────────────────
  const videoFormats = formats
    .filter(
      (f) =>
        f.height &&
        f.height > 0 &&
        f.ext !== "mhtml" &&
        f.vcodec !== "none"
    )
    .sort((a, b) => (b.height || 0) - (a.height || 0));

  const targetHeights = [
    { height: 2160, quality: "4k", label: "4K Ultra HD", badge: "4K" },
    { height: 1080, quality: "1080p", label: "1080p Full HD", badge: "Full HD" },
    { height: 720, quality: "720p", label: "720p HD", badge: "HD" },
    { height: 480, quality: "480p", label: "480p SD", badge: null },
    { height: 360, quality: "360p", label: "360p SD", badge: null },
    { height: 240, quality: "240p", label: "240p Low", badge: null },
  ];

  for (const target of targetHeights) {
    if (seenQualities.has(target.quality)) continue;
    const match = videoFormats.find(
      (f) =>
        f.height != null &&
        f.height <= target.height &&
        f.height >= target.height * 0.7
    );
    if (match) {
      seenQualities.add(target.quality);
      results.push({
        formatId: match.format_id,
        quality: target.quality,
        label: target.label,
        type: "video",
        filesize: match.filesize || match.filesize_approx || null,
        badge: target.badge,
      });
    }
  }

  // If no target heights matched but video formats exist, include the best one
  if (!results.some((r) => r.type === "video") && videoFormats.length > 0) {
    const best = videoFormats[0];
    results.push({
      formatId: best.format_id,
      quality: "best",
      label: "Best Available",
      type: "video",
      filesize: best.filesize || best.filesize_approx || null,
      badge: "Best",
    });
  }

  // ── FALLBACK for platforms with no height metadata (Facebook sd/hd, etc.) ──
  // If still no video formats, look for mp4 formats with named quality ids
  if (!results.some((r) => r.type === "video")) {
    const namedFormats = formats.filter(
      (f) =>
        f.ext === "mp4" &&
        f.vcodec !== "none"
    );
    const hdFmt = namedFormats.find((f) => f.format_id === "hd" || f.format_id.includes("hd"));
    const sdFmt = namedFormats.find((f) => f.format_id === "sd" || f.format_id.includes("sd"));
    if (hdFmt) {
      results.push({
        formatId: hdFmt.format_id,
        quality: "hd",
        label: "HD Quality",
        type: "video",
        filesize: hdFmt.filesize || hdFmt.filesize_approx || null,
        badge: "HD",
      });
    }
    if (sdFmt) {
      results.push({
        formatId: sdFmt.format_id,
        quality: "sd",
        label: "SD Quality",
        type: "video",
        filesize: sdFmt.filesize || sdFmt.filesize_approx || null,
        badge: null,
      });
    }
    // Last resort: pick the first valid mp4 format
    if (!results.some((r) => r.type === "video") && namedFormats.length > 0) {
      const f = namedFormats[0];
      results.push({
        formatId: f.format_id,
        quality: "best",
        label: "Best Available",
        type: "video",
        filesize: f.filesize || f.filesize_approx || null,
        badge: "Best",
      });
    }
  }

  // ──────────────────────────────────
  // AUDIO FORMATS
  // yt-dlp sometimes returns acodec=null for audio-only formats (YouTube).
  // We detect audio-only by: vcodec='none' AND no height AND not mhtml.
  // If none found, we still offer 3 virtual MP3 options using 'bestaudio' selector.
  // ──────────────────────────────────
  const explicitAudio = formats.filter(
    (f) =>
      f.vcodec === "none" &&
      !f.height &&
      f.ext !== "mhtml"
  );

  if (explicitAudio.length > 0) {
    // Sort by bitrate descending
    explicitAudio.sort(
      (a, b) => (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0)
    );
    const best = explicitAudio[0];
    const mid = explicitAudio[Math.floor(explicitAudio.length / 2)];
    const low = explicitAudio[explicitAudio.length - 1];
    results.push(
      { formatId: `${best.format_id}:audio:320`, quality: "320kbps", label: "MP3 320kbps", type: "audio" as const, filesize: best.filesize || best.filesize_approx || null, badge: "Best Quality" },
      { formatId: `${mid.format_id}:audio:192`, quality: "192kbps", label: "MP3 192kbps", type: "audio" as const, filesize: mid.filesize || mid.filesize_approx || null, badge: null },
      { formatId: `${low.format_id}:audio:128`, quality: "128kbps", label: "MP3 128kbps", type: "audio" as const, filesize: low.filesize || low.filesize_approx || null, badge: null }
    );
  } else {
    // Virtual audio options — use yt-dlp's bestaudio selector at stream time
    results.push(
      { formatId: "bestaudio:audio:320", quality: "320kbps", label: "MP3 320kbps", type: "audio" as const, filesize: null, badge: "Best Quality" },
      { formatId: "bestaudio:audio:192", quality: "192kbps", label: "MP3 192kbps", type: "audio" as const, filesize: null, badge: null },
      { formatId: "bestaudio:audio:128", quality: "128kbps", label: "MP3 128kbps", type: "audio" as const, filesize: null, badge: null }
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

  try {
    const { stdout } = await execAsync(
      `yt-dlp --dump-json --no-playlist --no-warnings --socket-timeout 30 "${url}"`,
      { timeout: 60000 }
    );

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
    const error = err as Error & { stderr?: string };
    const stderr = error.stderr || error.message || "";
    req.log.error({ err: stderr.slice(0, 300) }, "yt-dlp info failed");

    if (stderr.includes("Private video") || stderr.includes("not available")) {
      res.status(422).json({ error: "This video is private or unavailable." });
    } else if (stderr.includes("Sign in") || stderr.includes("log in")) {
      res.status(422).json({ error: "This video requires login and cannot be downloaded." });
    } else if (stderr.includes("unsupported URL")) {
      res.status(422).json({ error: "URL not supported. Please use a direct video link." });
    } else if (platform === "TikTok") {
      res.status(422).json({
        error:
          "TikTok currently restricts server-side access. Try downloading from another platform or use a desktop yt-dlp client.",
      });
    } else {
      res.status(422).json({
        error: "Unable to fetch video info. Check the URL and try again.",
      });
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/video/download  →  returns a URL the frontend can trigger
// Strategy:
//   1. Parse audio flag from formatId ("xxx:audio:320")
//   2. For audio → always use stream endpoint (ffmpeg mp3 conversion needed)
//   3. For video → try --get-url to get direct CDN link:
//        • 1 URL returned → return it directly (plays + downloads correctly)
//        • 2 URLs returned (merged) → return stream endpoint
//        • error → return stream endpoint as fallback
// ─────────────────────────────────────────────────────────────────────────────
router.post("/download", async (req, res) => {
  const parsed = GetDownloadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request. Provide url and formatId." });
    return;
  }

  const { url, formatId } = parsed.data;

  if (!isValidUrl(url)) {
    res.status(400).json({ error: "Invalid URL." });
    return;
  }

  // Parse audio flag: "233:audio:320" or "bestaudio:audio:192"
  const parts = formatId.split(":");
  const isAudio = parts[1] === "audio";
  const actualFormatId = parts[0]; // yt-dlp format id or "bestaudio"
  const audioBitrate = parts[2] || "192";

  if (isAudio) {
    // Always stream audio (need ffmpeg mp3 conversion)
    const streamUrl = `/api/video/stream?url=${encodeURIComponent(url)}&formatId=${encodeURIComponent(actualFormatId)}&audio=true&bitrate=${audioBitrate}`;
    res.json({ downloadUrl: streamUrl, filename: `audio_${audioBitrate}kbps.mp3` });
    return;
  }

  // Video: try --get-url for direct CDN link
  try {
    const { stdout } = await execAsync(
      `yt-dlp -f "${actualFormatId}" --get-url --no-warnings --socket-timeout 20 "${url}"`,
      { timeout: 35000 }
    );

    const urls = stdout.trim().split("\n").filter(Boolean);

    const isHLS = (u: string) =>
      u.includes(".m3u8") ||
      u.includes("/manifest/") ||
      u.includes("manifest.googlevideo.com");

    if (urls.length === 1 && !isHLS(urls[0])) {
      // Direct CDN URL (Instagram, Facebook, Snapchat, Twitter) — browser downloads natively
      res.json({
        downloadUrl: urls[0],
        filename: `video_${actualFormatId}.mp4`,
      });
      return;
    }

    if (urls.length >= 1) {
      // HLS manifest or needs merging → use stream endpoint
      const streamUrl = `/api/video/stream?url=${encodeURIComponent(url)}&formatId=${encodeURIComponent(actualFormatId)}&audio=false`;
      res.json({ downloadUrl: streamUrl, filename: `video.mkv` });
      return;
    }

    throw new Error("No URLs returned");
  } catch {
    // Fallback: stream endpoint handles it
    const streamUrl = `/api/video/stream?url=${encodeURIComponent(url)}&formatId=${encodeURIComponent(actualFormatId)}&audio=false`;
    res.json({ downloadUrl: streamUrl, filename: `video_${actualFormatId}.mkv` });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/video/stream  →  streams actual file bytes to browser
// For video: uses ffmpeg to merge video+audio into MKV (seekable, plays everywhere)
// For audio: uses ffmpeg to convert to MP3
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
    // ── AUDIO: yt-dlp → ffmpeg → mp3 → pipe ──────────────────────────────
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Disposition", `attachment; filename="audio_${mp3Bitrate}kbps.mp3"`);

    const audioFmt =
      formatId === "bestaudio"
        ? "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio"
        : `${formatId}`;

    // Get the audio CDN URL first
    try {
      const { stdout } = await execAsync(
        `yt-dlp -f "${audioFmt}" --get-url --no-warnings --socket-timeout 20 "${url}"`,
        { timeout: 35000 }
      );
      const audioUrl = stdout.trim().split("\n")[0];
      if (!audioUrl) throw new Error("No audio URL");

      // Stream through ffmpeg for mp3 conversion
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
        req.log.info({ stderr: d.toString().slice(0, 200) }, "ffmpeg audio")
      );
      ffmpeg.on("error", (e) => {
        req.log.error({ err: e.message }, "ffmpeg audio error");
        if (!res.headersSent) res.status(500).end();
      });
      req.on("close", () => ffmpeg.kill());
    } catch (err) {
      // Fallback: pipe yt-dlp directly with -x flag
      req.log.warn("Audio CDN URL fetch failed, falling back to yt-dlp pipe");
      const ytdlp = spawn("yt-dlp", [
        "-f", `${audioFmt}`,
        "-x", "--audio-format", "mp3",
        "--audio-quality", `${mp3Bitrate}K`,
        "--no-warnings",
        "-o", "-",
        url,
      ]);
      ytdlp.stdout.pipe(res);
      ytdlp.stderr.on("data", (d: Buffer) =>
        req.log.info({ stderr: d.toString().slice(0, 200) }, "yt-dlp audio fallback")
      );
      ytdlp.on("error", (e) => {
        if (!res.headersSent) res.status(500).end();
        req.log.error({ err: e.message }, "yt-dlp audio fallback error");
      });
      req.on("close", () => ytdlp.kill());
    }
    return;
  }

  // ── VIDEO: yt-dlp → optionally ffmpeg merge → MKV pipe ──────────────────
  res.setHeader("Content-Type", "video/x-matroska");
  res.setHeader("Content-Disposition", `attachment; filename="video.mkv"`);

  try {
    // Get CDN URL(s) — 1 URL = single stream, 2 URLs = needs merge
    const { stdout } = await execAsync(
      `yt-dlp -f "${formatId}+bestaudio/${formatId}/best" --get-url --no-warnings --socket-timeout 20 "${url}"`,
      { timeout: 35000 }
    );

    const urls = stdout.trim().split("\n").filter(Boolean);

    if (urls.length >= 2) {
      // Merge video + audio using ffmpeg
      const [vidUrl, audUrl] = urls;
      const ffmpeg = spawn("ffmpeg", [
        "-i", vidUrl,
        "-i", audUrl,
        "-c:v", "copy",
        "-c:a", "aac",
        "-f", "matroska",
        "pipe:1",
      ]);

      ffmpeg.stdout.pipe(res);
      ffmpeg.stderr.on("data", (d: Buffer) =>
        req.log.info({ stderr: d.toString().slice(0, 200) }, "ffmpeg merge")
      );
      ffmpeg.on("error", (e) => {
        req.log.error({ err: e.message }, "ffmpeg merge error");
        if (!res.headersSent) res.status(500).end();
      });
      req.on("close", () => ffmpeg.kill());
    } else if (urls.length === 1) {
      // Single stream: pipe through ffmpeg to ensure correct MKV container
      const ffmpeg = spawn("ffmpeg", [
        "-i", urls[0],
        "-c:v", "copy",
        "-c:a", "copy",
        "-f", "matroska",
        "pipe:1",
      ]);

      ffmpeg.stdout.pipe(res);
      ffmpeg.stderr.on("data", (d: Buffer) =>
        req.log.info({ stderr: d.toString().slice(0, 200) }, "ffmpeg remux")
      );
      ffmpeg.on("error", (e) => {
        req.log.error({ err: e.message }, "ffmpeg remux error");
        if (!res.headersSent) res.status(500).end();
      });
      req.on("close", () => ffmpeg.kill());
    } else {
      throw new Error("No CDN URLs returned");
    }
  } catch (err) {
    // Last resort: pipe yt-dlp output directly
    req.log.warn({ err: (err as Error).message }, "Stream CDN fetch failed, using yt-dlp pipe");
    const ytdlp = spawn("yt-dlp", [
      "-f", `${formatId}/best`,
      "--no-warnings",
      "-o", "-",
      url,
    ]);
    ytdlp.stdout.pipe(res);
    ytdlp.stderr.on("data", (d: Buffer) =>
      req.log.info({ stderr: d.toString().slice(0, 200) }, "yt-dlp stream fallback")
    );
    ytdlp.on("error", (e) => {
      if (!res.headersSent) res.status(500).end();
    });
    req.on("close", () => ytdlp.kill());
  }
});

export default router;
