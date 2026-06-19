/**
 * yt-dlp Manager — auto-updates binary on startup, provides resilient
 * YouTube client rotation so YouTube can never permanently block us.
 */
import { execSync, exec } from "child_process";
import { promisify } from "util";
import { existsSync, chmodSync, writeFileSync, readFileSync } from "fs";
import { logger } from "./logger";

const execAsync = promisify(exec);

// ── Binary paths ────────────────────────────────────────────────────────────
const CUSTOM_BIN = "/home/runner/workspace/bin/yt-dlp-latest";
const VERSION_FILE = "/home/runner/workspace/bin/.yt-dlp-version";

let resolvedBin: string | null = null;

export function getYtDlpBin(): string {
  if (resolvedBin) return resolvedBin;
  if (existsSync(CUSTOM_BIN)) {
    resolvedBin = CUSTOM_BIN;
  } else {
    resolvedBin = "yt-dlp";
  }
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
    // Must chmod before exec-verifying
    chmodSync(`${CUSTOM_BIN}.tmp`, 0o755);
    // Verify it's a valid binary
    const { stdout } = await execAsync(`"${CUSTOM_BIN}.tmp" --version`, { timeout: 10000 });
    if (!stdout.trim()) throw new Error("invalid binary");
    // Replace old binary
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
// Ordered by reliability (mid-2026). We remember which clients worked recently.
// If YouTube starts blocking one, the next in line takes over automatically.

const YT_CLIENTS = [
  "android,ios",    // Combined: gets all formats (360p combined + HD video-only) — best
  "ios",            // HD only: 144p-2160p video-only formats — great quality
  "android",        // 360p combined mp4 — reliable fallback, no PO token needed
  "mweb",           // Mobile web — alternate path
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

const COOLDOWN_MS = 5 * 60 * 1000; // 5 min cooldown after 3 failures

function getClientOrder(): YtClient[] {
  const now = Date.now();
  return [...YT_CLIENTS].sort((a, b) => {
    const ha = clientHealth.get(a)!;
    const hb = clientHealth.get(b)!;
    // Penalize clients with recent failures still in cooldown
    const aCooling = ha.failures >= 3 && (now - ha.lastFailure) < COOLDOWN_MS;
    const bCooling = hb.failures >= 3 && (now - hb.lastFailure) < COOLDOWN_MS;
    if (aCooling && !bCooling) return 1;
    if (!aCooling && bCooling) return -1;
    // Prefer most recently successful
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

/** Try an async operation across multiple YouTube clients in priority order.
 *  Returns first success. Throws if all clients fail. */
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
      // If HD required, caller must check — we trust the result here
      recordSuccess(client);
      logger.info({ client }, "YouTube client succeeded");
      return { result, client };
    } catch (err) {
      const msg = ((err as Error & { stderr?: string }).stderr || (err as Error).message || "").slice(0, 200);
      recordFailure(client);
      errors.push(`[${client}] ${msg}`);
      logger.warn({ client, err: msg }, "YouTube client failed, trying next");

      // Don't retry permanent errors (login, private, removed)
      const isPermanent = ["Sign in", "log in", "Private", "not available", "removed", "copyright"]
        .some((s) => msg.toLowerCase().includes(s.toLowerCase()));
      if (isPermanent) throw err;
    }
  }

  throw new Error(`All YouTube clients failed:\n${errors.join("\n")}`);
}

/** Get current health status of all clients (for diagnostics) */
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
