import { Router } from "express";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
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

function formatBytes(bytes: number | null | undefined): number | null {
  if (bytes == null || bytes <= 0) return null;
  return bytes;
}

interface YtDlpFormat {
  format_id: string;
  format_note?: string;
  ext?: string;
  vcodec?: string;
  acodec?: string;
  height?: number;
  width?: number;
  filesize?: number;
  filesize_approx?: number;
  tbr?: number;
  abr?: number;
  asr?: number;
  quality?: number;
}

interface YtDlpInfo {
  title?: string;
  thumbnail?: string;
  duration?: number;
  formats?: YtDlpFormat[];
  url?: string;
  direct_url?: string;
  ext?: string;
  format_id?: string;
  height?: number;
  filesize?: number;
  filesize_approx?: number;
  webpage_url?: string;
  id?: string;
}

function buildFormats(formats: YtDlpFormat[] | undefined, url: string) {
  if (!formats || formats.length === 0) {
    return [];
  }

  const results: Array<{
    formatId: string;
    quality: string;
    label: string;
    type: "video" | "audio";
    filesize: number | null;
    badge: string | null;
  }> = [];

  const seenQualities = new Set<string>();

  // Video formats: prefer formats with both video+audio (or video-only with good quality)
  const videoFormats = formats.filter(
    (f) =>
      f.vcodec &&
      f.vcodec !== "none" &&
      f.height &&
      f.height > 0 &&
      f.ext !== "mhtml"
  );

  // Sort by height descending
  videoFormats.sort((a, b) => (b.height || 0) - (a.height || 0));

  const targetHeights: Array<{
    height: number;
    quality: string;
    label: string;
    badge: string | null;
  }> = [
    { height: 2160, quality: "4k", label: "4K Ultra HD", badge: "4K" },
    { height: 1080, quality: "1080p", label: "1080p Full HD", badge: "Full HD" },
    { height: 720, quality: "720p", label: "720p HD", badge: "HD" },
    { height: 480, quality: "480p", label: "480p SD", badge: null },
    { height: 360, quality: "360p", label: "360p SD", badge: null },
    { height: 240, quality: "240p", label: "240p Low", badge: null },
  ];

  for (const target of targetHeights) {
    if (seenQualities.has(target.quality)) continue;

    // Find best format at or near this height
    // First try formats with BOTH video+audio merged
    let match = videoFormats.find(
      (f) =>
        f.height &&
        f.height <= target.height &&
        f.height >= target.height * 0.75 &&
        f.acodec &&
        f.acodec !== "none"
    );

    // If no combined format, find video-only (will need to merge audio)
    if (!match) {
      match = videoFormats.find(
        (f) => f.height && f.height <= target.height && f.height >= target.height * 0.75
      );
    }

    if (match) {
      seenQualities.add(target.quality);
      results.push({
        formatId: match.format_id,
        quality: target.quality,
        label: target.label,
        type: "video",
        filesize: formatBytes(match.filesize || match.filesize_approx),
        badge: target.badge,
      });
    }
  }

  // Audio formats (MP3-like)
  const audioFormats = formats.filter(
    (f) =>
      (f.vcodec === "none" || !f.vcodec) &&
      f.acodec &&
      f.acodec !== "none" &&
      f.ext !== "mhtml"
  );

  // Sort by bitrate descending
  audioFormats.sort((a, b) => (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0));

  const audioTargets = [
    { minAbr: 256, quality: "mp3_320", label: "MP3 320kbps", badge: "Best Quality" },
    { minAbr: 160, quality: "mp3_192", label: "MP3 192kbps", badge: null },
    { minAbr: 0, quality: "mp3_128", label: "MP3 128kbps", badge: null },
  ];

  for (const target of audioTargets) {
    if (seenQualities.has(target.quality)) continue;
    const match = audioFormats.find((f) => (f.abr || f.tbr || 0) >= target.minAbr);
    if (match) {
      seenQualities.add(target.quality);
      results.push({
        formatId: match.format_id,
        quality: target.quality,
        label: target.label,
        type: "audio",
        filesize: formatBytes(match.filesize || match.filesize_approx),
        badge: target.badge,
      });
    }
  }

  // If no audio formats found but there are formats, add a best audio option
  if (!results.some((r) => r.type === "audio") && formats.length > 0) {
    const bestAudio = audioFormats[0] || formats.find(f => f.acodec && f.acodec !== "none");
    if (bestAudio) {
      results.push({
        formatId: bestAudio.format_id + "_mp3",
        quality: "mp3_128",
        label: "MP3 128kbps",
        type: "audio",
        filesize: null,
        badge: null,
      });
    }
  }

  return results;
}

// POST /api/video/info
router.post("/info", async (req, res) => {
  const parsed = GetVideoInfoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body. Provide a valid URL." });
    return;
  }

  const { url } = parsed.data;

  if (!isValidUrl(url)) {
    res.status(400).json({ error: "Invalid URL. Please enter a valid video URL." });
    return;
  }

  const platform = detectPlatform(url);
  if (platform === "Unknown") {
    res.status(400).json({
      error: "Unsupported platform. We support YouTube, TikTok, Instagram, Facebook, Snapchat, and Twitter/X.",
    });
    return;
  }

  try {
    const { stdout } = await execAsync(
      `yt-dlp --dump-json --no-playlist --no-warnings --socket-timeout 30 "${url}"`,
      { timeout: 60000 }
    );

    const info: YtDlpInfo = JSON.parse(stdout.trim().split("\n")[0]);

    const formats = buildFormats(info.formats, url);

    res.json({
      url,
      title: info.title || "Unknown Video",
      thumbnail: info.thumbnail || null,
      duration: info.duration || null,
      platform,
      formats,
    });
  } catch (err) {
    const error = err as Error;
    req.log.error({ err: error.message }, "yt-dlp info failed");

    if (error.message?.includes("not available") || error.message?.includes("Private video")) {
      res.status(422).json({ error: "This video is private or unavailable." });
    } else if (error.message?.includes("unsupported URL")) {
      res.status(422).json({ error: "This URL is not supported. Please try a direct video URL." });
    } else if (error.message?.includes("Sign in")) {
      res.status(422).json({ error: "This video requires sign-in and cannot be downloaded." });
    } else {
      res.status(422).json({
        error: "Unable to fetch video information. Please check the URL and try again.",
      });
    }
  }
});

// POST /api/video/download - returns direct URL or streaming endpoint
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

  const platform = detectPlatform(url);
  if (platform === "Unknown") {
    res.status(400).json({ error: "Unsupported platform." });
    return;
  }

  // Determine if audio conversion needed
  const isAudio = formatId.includes("mp3");
  const actualFormatId = formatId.replace("_mp3", "");

  try {
    // Use yt-dlp to get the direct URL for this format
    const formatSpec = isAudio
      ? `bestaudio`
      : actualFormatId === formatId
      ? `${formatId}+bestaudio/best[height<=${getHeightFromFormatId(formatId)}]/${formatId}/best`
      : formatId;

    const { stdout } = await execAsync(
      `yt-dlp -f "${formatSpec}" --get-url --no-warnings --socket-timeout 30 "${url}"`,
      { timeout: 60000 }
    );

    const lines = stdout.trim().split("\n").filter(Boolean);
    if (!lines.length) {
      throw new Error("No download URL returned");
    }

    // For merged formats (video+audio), yt-dlp returns 2 lines (video URL + audio URL)
    // We'll create a streaming proxy endpoint instead
    const downloadUrl = `/api/video/stream?url=${encodeURIComponent(url)}&formatId=${encodeURIComponent(actualFormatId)}&audio=${isAudio}`;
    const filename = `video_${Date.now()}.${isAudio ? "mp3" : "mp4"}`;

    res.json({ downloadUrl, filename });
  } catch (err) {
    const error = err as Error;
    req.log.error({ err: error.message }, "yt-dlp download failed");
    res.status(422).json({
      error: "Unable to generate download link. Please try again.",
    });
  }
});

function getHeightFromFormatId(formatId: string): number {
  if (formatId.includes("4k") || formatId.includes("2160")) return 2160;
  if (formatId.includes("1080")) return 1080;
  if (formatId.includes("720")) return 720;
  if (formatId.includes("480")) return 480;
  if (formatId.includes("360")) return 360;
  return 720;
}

// GET /api/video/stream - stream the actual file
router.get("/stream", async (req, res) => {
  const { url, formatId, audio } = req.query as {
    url: string;
    formatId: string;
    audio: string;
  };

  if (!url || !isValidUrl(url)) {
    res.status(400).json({ error: "Invalid URL." });
    return;
  }

  const isAudio = audio === "true";
  const ext = isAudio ? "mp3" : "mp4";
  const filename = `videotools_${Date.now()}.${ext}`;

  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Type", isAudio ? "audio/mpeg" : "video/mp4");

  const formatSpec = isAudio
    ? "bestaudio[ext=m4a]/bestaudio"
    : `${formatId}+bestaudio/${formatId}/best`;

  const postprocessArgs = isAudio
    ? `-x --audio-format mp3 --audio-quality 0`
    : `--merge-output-format mp4`;

  const ytdlpCmd = [
    "yt-dlp",
    `-f "${formatSpec}"`,
    postprocessArgs,
    `--no-warnings`,
    `--socket-timeout 30`,
    `-o -`,
    `"${url}"`,
  ].join(" ");

  const { spawn } = await import("child_process");
  const proc = spawn("sh", ["-c", ytdlpCmd]);

  proc.stdout.pipe(res);

  proc.stderr.on("data", (data: Buffer) => {
    req.log.info({ stderr: data.toString() }, "yt-dlp stderr");
  });

  proc.on("error", (err) => {
    req.log.error({ err: err.message }, "yt-dlp stream process error");
    if (!res.headersSent) {
      res.status(500).json({ error: "Stream failed." });
    }
  });

  req.on("close", () => {
    proc.kill();
  });
});

export default router;
