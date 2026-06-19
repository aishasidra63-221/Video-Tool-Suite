/**
 * yt-dlp Manager — auto-updates binary on startup, provides resilient
 * YouTube client rotation so YouTube can never permanently block us.
 * Also manages YouTube and Instagram cookies for bot-challenge bypass.
 */
import { execSync, exec } from "child_process";
import { promisify } from "util";
import { existsSync, chmodSync, writeFileSync, readFileSync, unlinkSync, mkdirSync } from "fs";
import { logger } from "./logger";

const execAsync = promisify(exec);

// ── Ensure bin directory exists ──────────────────────────────────────────────
const BIN_DIR = "/home/runner/workspace/bin";
try { mkdirSync(BIN_DIR, { recursive: true }); } catch {}

// ── Binary paths ────────────────────────────────────────────────────────────
const CUSTOM_BIN = `${BIN_DIR}/yt-dlp-latest`;
const VERSION_FILE = `${BIN_DIR}/.yt-dlp-version`;

// ── YouTube Cookies ──────────────────────────────────────────────────────────
export const COOKIES_FILE = `${BIN_DIR}/youtube-cookies.txt`;

export function hasCookies(): boolean {
  return existsSync(COOKIES_FILE);
}

export function saveCookies(content: string): void {
  writeFileSync(COOKIES_FILE, content, "utf8");
  logger.info("YouTube cookies saved");
}

export function deleteCookies(): void {
  if (existsSync(COOKIES_FILE)) {
    unlinkSync(COOKIES_FILE);
    logger.info("YouTube cookies deleted");
  }
}

export function getCookiesFlag(): string {
  return hasCookies() ? `--cookies "${COOKIES_FILE}"` : "";
}

// ── Instagram Cookies ─────────────────────────────────────────────────────────
export const INSTAGRAM_COOKIES_FILE = `${BIN_DIR}/instagram-cookies.txt`;

export function hasInstagramCookies(): boolean {
  return existsSync(INSTAGRAM_COOKIES_FILE);
}

export function saveInstagramCookies(content: string): void {
  writeFileSync(INSTAGRAM_COOKIES_FILE, content, "utf8");
  logger.info("Instagram cookies saved");
}

export function deleteInstagramCookies(): void {
  if (existsSync(INSTAGRAM_COOKIES_FILE)) {
    unlinkSync(INSTAGRAM_COOKIES_FILE);
    logger.info("Instagram cookies deleted");
  }
}

export function getInstagramCookiesFlag(): string {
  return hasInstagramCookies() ? `--cookies "${INSTAGRAM_COOKIES_FILE}"` : "";
}

// ── Binary resolution ────────────────────────────────────────────────────────
let resolvedBin: string | null = null;

export function getYtDlpBin(): string {
  if (resolvedBin) return resolvedBin;
  if (existsSync(CUSTOM_BIN)) {
    resolvedBin = CUSTOM_BIN;
  } else {
    // Resolve absolute path so Node.js exec inherits the correct binary
    try {
      const p = execSync("which yt-dlp", { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }).trim();
      if (p) resolvedBin = p;
    } catch {}
    if (!resolvedBin) resolvedBin = "yt-dlp";
  }
  logger.info({ bin: resolvedBin }, "yt-dlp binary resolved");
  return resolvedBin;
}

// ── Auto-update: download latest yt-dlp binary from GitHub ─────────────────
async function fetchLatestVersion(): Promise<string | null> {
  try {
    const { stdout } = await execAsync(
      `curl -sf https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest`,
      { timeout: 10000 }
    );
    const release = JSON.parse(stdout);
    return release.tag_name as string;
  } catch {
    return null;
  }
}

async function downloadBinary(version: string): Promise<boolean> {
  try {
    const url = `https://github.com/yt-dlp/yt-dlp/releases/download/${version}/yt-dlp`;
    await execAsync(
      `curl -sL --max-time 60 -o "${CUSTOM_BIN}.tmp" "${url}"`,
      { timeout: 65000 }
    );
    chmodSync(`${CUSTOM_BIN}.tmp`, 0o755);
    const { stdout } = await execAsync(`"${CUSTOM_BIN}.tmp" --version`, { timeout: 10000 });
    if (!stdout.trim()) throw new Error("invalid binary");
    execSync(`mv "${CUSTOM_BIN}.tmp" "${CUSTOM_BIN}"`);
    chmodSync(CUSTOM_BIN, 0o755);
    writeFileSync(VERSION_FILE, version);
    resolvedBin = CUSTOM_BIN;
    logger.info({ version }, "yt-dlp updated successfully");
    return true;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "yt-dlp download failed, keeping current");
    return false;
  }
}

export async function autoUpdateYtDlp(): Promise<void> {
  try {
    const latestVersion = await fetchLatestVersion();
    if (!latestVersion) {
      logger.warn("Could not fetch yt-dlp latest version");
      return;
    }

    const currentVersion = existsSync(VERSION_FILE)
      ? readFileSync(VERSION_FILE, "utf8").trim()
      : null;

    if (currentVersion === latestVersion && existsSync(CUSTOM_BIN)) {
      logger.info({ version: latestVersion }, "yt-dlp already up to date");
      resolvedBin = CUSTOM_BIN;
      return;
    }

    logger.info({ latestVersion, currentVersion }, "Updating yt-dlp binary...");
    await downloadBinary(latestVersion);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "yt-dlp auto-update skipped");
  }
}

// ── IP Spoofing via --xff (X-Forwarded-For) ──────────────────────────────────
// yt-dlp's --xff flag accepts a 2-letter ISO country code. yt-dlp then picks
// a random IP from that country's IANA-allocated ranges and injects it as the
// X-Forwarded-For header in YouTube requests — making each call appear to come
// from a real residential user in a different country.
//
// This bypasses YouTube's per-server-IP rate limits and bot-detection heuristics.

const XFF_COUNTRIES = [
  "US", // United States  — largest YouTube user base, least suspicious
  "US", // weighted 2x — US traffic is most common, double the odds
  "GB", // United Kingdom
  "DE", // Germany
  "FR", // France
  "CA", // Canada
  "AU", // Australia
  "JP", // Japan
  "NL", // Netherlands
  "BR", // Brazil
  "MX", // Mexico
  "IN", // India
  "KR", // South Korea
  "SE", // Sweden
  "PL", // Poland
];

/** Return the --xff flag with a random country code for yt-dlp */
export function getXffFlag(): string {
  const country = XFF_COUNTRIES[Math.floor(Math.random() * XFF_COUNTRIES.length)];
  logger.debug({ country }, "XFF country rotation");
  return `--xff "${country}"`;
}

/** Returns a random country code (for logging/display) */
export function randomCountryCode(): string {
  return XFF_COUNTRIES[Math.floor(Math.random() * XFF_COUNTRIES.length)];
}

// ── Browser Fingerprint Spoofing via HTTP Headers ────────────────────────────
// YouTube inspects HTTP headers to detect bots. Python's default headers are
// instantly recognisable. We rotate realistic Chrome/Firefox/Edge profiles —
// each with a matching User-Agent, sec-ch-ua, Accept-Language, and platform.
//
// Combined with --xff country rotation + client rotation this makes each
// request look like a unique real user from a different browser and country.

interface BrowserProfile {
  name: string;
  userAgent: string;
  secChUa: string;
  secChUaMobile: string;
  secChUaPlatform: string;
  acceptLanguage: string;
  accept: string;
}

const BROWSER_PROFILES: BrowserProfile[] = [
  // Chrome 124 on Windows — most common desktop browser worldwide
  {
    name: "Chrome/Win",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    secChUa: '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    secChUaMobile: "?0",
    secChUaPlatform: '"Windows"',
    acceptLanguage: "en-US,en;q=0.9",
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  },
  // Chrome 124 on macOS
  {
    name: "Chrome/Mac",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    secChUa: '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    secChUaMobile: "?0",
    secChUaPlatform: '"macOS"',
    acceptLanguage: "en-GB,en;q=0.9",
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  },
  // Chrome 123 on Android — mobile user
  {
    name: "Chrome/Android",
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.6312.118 Mobile Safari/537.36",
    secChUa: '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
    secChUaMobile: "?1",
    secChUaPlatform: '"Android"',
    acceptLanguage: "en-US,en;q=0.9",
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  },
  // Firefox 126 on Windows
  {
    name: "Firefox/Win",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
    secChUa: "",  // Firefox doesn't send sec-ch-ua
    secChUaMobile: "",
    secChUaPlatform: "",
    acceptLanguage: "en-US,en;q=0.5",
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  },
  // Edge 124 on Windows
  {
    name: "Edge/Win",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
    secChUa: '"Chromium";v="124", "Microsoft Edge";v="124", "Not-A.Brand";v="99"',
    secChUaMobile: "?0",
    secChUaPlatform: '"Windows"',
    acceptLanguage: "de-DE,de;q=0.9,en;q=0.8",
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
  },
  // Chrome 124 on Linux — en-GB locale
  {
    name: "Chrome/Linux",
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    secChUa: '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    secChUaMobile: "?0",
    secChUaPlatform: '"Linux"',
    acceptLanguage: "fr-FR,fr;q=0.9,en;q=0.8",
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  },
  // Safari on macOS — very different UA pattern
  {
    name: "Safari/Mac",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15",
    secChUa: "",  // Safari doesn't send sec-ch-ua
    secChUaMobile: "",
    secChUaPlatform: "",
    acceptLanguage: "ja-JP,ja;q=0.9,en;q=0.8",
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  },
  // Chrome 124 on Windows — Brazilian Portuguese locale
  {
    name: "Chrome/Win/BR",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    secChUa: '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    secChUaMobile: "?0",
    secChUaPlatform: '"Windows"',
    acceptLanguage: "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  },
];

/**
 * Returns --add-header flags for yt-dlp that mimic a real browser.
 * Each call picks a random browser profile — rotating UA, locale, and platform.
 *
 * NOTE: sec-ch-ua is intentionally excluded — its value contains commas and
 * double-quotes that break shell argument parsing when passed to yt-dlp via
 * --add-header. The User-Agent + Accept-Language + sec-fetch-* headers are
 * sufficient to pass YouTube's HTTP-layer bot detection.
 */
export function getBrowserHeaderFlags(): string {
  const profile = BROWSER_PROFILES[Math.floor(Math.random() * BROWSER_PROFILES.length)];
  const headers: string[] = [];

  // Only add headers whose values are shell-safe (no commas or inner quotes).
  const addHeader = (name: string, value: string) => {
    if (value) headers.push(`--add-header "${name}:${value}"`);
  };

  addHeader("User-Agent", profile.userAgent);
  addHeader("Accept-Language", profile.acceptLanguage);
  addHeader("Accept-Encoding", "gzip, deflate, br");
  addHeader("Cache-Control", "no-cache");
  addHeader("Pragma", "no-cache");
  addHeader("Upgrade-Insecure-Requests", "1");
  addHeader("sec-fetch-site", "none");
  addHeader("sec-fetch-mode", "navigate");
  addHeader("sec-fetch-user", "?1");
  addHeader("sec-fetch-dest", "document");

  logger.debug({ browser: profile.name, lang: profile.acceptLanguage }, "Browser fingerprint rotation");
  return headers.join(" ");
}

// ── YouTube Client Rotation ─────────────────────────────────────────────────
// Tested 2026-06: ios, android_embedded, android_testsuite, android_music
// all return full HD (4K/1440p/1080p/720p/480p) without PO token.
// android=360p only, mweb=error, tv_embedded=not supported.
// ios broken in yt-dlp 2026.06+; tv_embedded added as replacement
const YT_CLIENTS = [
  "android_embedded",
  "android_testsuite",
  "android_music",
  "tv_embedded",
] as const;

type YtClient = typeof YT_CLIENTS[number];

interface ClientHealth {
  failures: number;
  lastFailure: number;
  lastSuccess: number;
}

const clientHealth = new Map<YtClient, ClientHealth>(
  YT_CLIENTS.map((c) => [c, { failures: 0, lastFailure: 0, lastSuccess: 0 }])
);

const COOLDOWN_MS = 5 * 60 * 1000;

function getClientOrder(): YtClient[] {
  const now = Date.now();
  return [...YT_CLIENTS].sort((a, b) => {
    const ha = clientHealth.get(a)!;
    const hb = clientHealth.get(b)!;
    const aCooling = ha.failures >= 3 && (now - ha.lastFailure) < COOLDOWN_MS;
    const bCooling = hb.failures >= 3 && (now - hb.lastFailure) < COOLDOWN_MS;
    if (aCooling && !bCooling) return 1;
    if (!aCooling && bCooling) return -1;
    return hb.lastSuccess - ha.lastSuccess;
  });
}

function recordSuccess(client: YtClient) {
  const h = clientHealth.get(client)!;
  h.failures = 0;
  h.lastSuccess = Date.now();
}

function recordFailure(client: YtClient) {
  const h = clientHealth.get(client)!;
  h.failures++;
  h.lastFailure = Date.now();
}

const PERMANENT_CLIENT_ERRORS = [
  "sign in to confirm", "sign in to watch", "log in",
  "this video is private", "video is private",
  "this video has been removed", "video has been removed",
  "copyright", "not available on this app",
  "no longer supported", "unsupported url",
];

function isPermanentClientError(msg: string): boolean {
  return PERMANENT_CLIENT_ERRORS.some((s) => msg.toLowerCase().includes(s.toLowerCase()));
}

/**
 * Sequential client rotation — tries clients one by one in health-ranked order.
 * Used for streaming/download where parallel attempts waste bandwidth.
 */
export async function withYtClientRotation<T>(
  fn: (clientFlag: string) => Promise<T>,
  options: { requireHD?: boolean } = {}
): Promise<{ result: T; client: YtClient }> {
  const ordered = getClientOrder();
  const errors: string[] = [];

  for (const client of ordered) {
    const flag = `--extractor-args "youtube:player_client=${client}"`;
    try {
      const result = await fn(flag);
      recordSuccess(client);
      logger.info({ client }, "YouTube client succeeded");
      return { result, client };
    } catch (err) {
      const msg = ((err as Error & { stderr?: string }).stderr || (err as Error).message || "").slice(0, 200);
      recordFailure(client);
      errors.push(`[${client}] ${msg}`);
      logger.warn({ client, err: msg }, "YouTube client failed, trying next");
      if (isPermanentClientError(msg)) throw err;
    }
  }

  throw new Error(`All YouTube clients failed:\n${errors.join("\n")}`);
}

/**
 * Parallel client rotation — races top 2 clients simultaneously, uses whichever
 * responds first. Falls back to sequential for remaining clients if both fail.
 * Use for /info calls where latency matters more than resource usage.
 */
export async function withYtClientRotationFast<T>(
  fn: (clientFlag: string) => Promise<T>
): Promise<{ result: T; client: YtClient }> {
  const ordered = getClientOrder();

  // Race the top 2 healthy clients in parallel
  const top = ordered.slice(0, 2);
  const rest = ordered.slice(2);

  interface Success { result: T; client: YtClient; }

  const raceTop = Promise.any(
    top.map(async (client): Promise<Success> => {
      const flag = `--extractor-args "youtube:player_client=${client}"`;
      try {
        const result = await fn(flag);
        recordSuccess(client);
        logger.info({ client }, "YouTube fast-race client succeeded");
        return { result, client };
      } catch (err) {
        const msg = ((err as Error & { stderr?: string }).stderr || (err as Error).message || "").slice(0, 200);
        recordFailure(client);
        logger.warn({ client, err: msg }, "YouTube fast-race client failed");
        if (isPermanentClientError(msg)) throw err; // bubble up permanent errors
        throw err;
      }
    })
  );

  try {
    return await raceTop;
  } catch {
    // Both top clients failed — try remaining sequentially
    const errors: string[] = [];
    for (const client of rest) {
      const flag = `--extractor-args "youtube:player_client=${client}"`;
      try {
        const result = await fn(flag);
        recordSuccess(client);
        logger.info({ client }, "YouTube fallback client succeeded");
        return { result, client };
      } catch (err) {
        const msg = ((err as Error & { stderr?: string }).stderr || (err as Error).message || "").slice(0, 200);
        recordFailure(client);
        errors.push(`[${client}] ${msg}`);
        if (isPermanentClientError(msg)) throw err;
      }
    }
    throw new Error(`All YouTube clients failed:\n${errors.join("\n")}`);
  }
}

export function getClientHealthStatus() {
  const now = Date.now();
  return Object.fromEntries(
    [...clientHealth.entries()].map(([c, h]) => [
      c,
      {
        failures: h.failures,
        inCooldown: h.failures >= 3 && (now - h.lastFailure) < COOLDOWN_MS,
        lastSuccess: h.lastSuccess ? new Date(h.lastSuccess).toISOString() : null,
      },
    ])
  );
}
