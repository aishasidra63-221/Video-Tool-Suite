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

// ── YouTube Client Rotation ─────────────────────────────────────────────────
// Tested 2026-06: ios, android_embedded, android_testsuite, android_music
// all return full HD (4K/1440p/1080p/720p/480p) without PO token.
// android=360p only, mweb=error, tv_embedded=not supported.
const YT_CLIENTS = [
  "ios",
  "android_embedded",
  "android_testsuite",
  "android_music",
  "android,ios",
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

      // Only bail early on errors that NO client can fix (video is gone/private/geo-blocked).
      // Do NOT include "not available" broadly — "Requested format is not available" is
      // client-specific and another client (android_embedded, android_testsuite) may succeed.
      const isPermanent = [
        "sign in to confirm", "sign in to watch", "log in",
        "this video is private", "video is private",
        "this video has been removed", "video has been removed",
        "copyright", "not available on this app",
        "no longer supported", "unsupported url",
      ].some((s) => msg.toLowerCase().includes(s.toLowerCase()));
      if (isPermanent) throw err;
    }
  }

  throw new Error(`All YouTube clients failed:\n${errors.join("\n")}`);
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
