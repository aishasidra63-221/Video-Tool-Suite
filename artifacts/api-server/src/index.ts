import app from "./app";
import { logger } from "./lib/logger";
import { autoUpdateYtDlp } from "./lib/ytdlp-manager";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Auto-update yt-dlp in background — don't block server startup
autoUpdateYtDlp()
  .then(() => logger.info("yt-dlp check complete"))
  .catch((err) => logger.warn({ err: err.message }, "yt-dlp auto-update error"));

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
