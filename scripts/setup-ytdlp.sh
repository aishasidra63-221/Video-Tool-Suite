#!/bin/bash
# Download latest yt-dlp standalone binary if not present
YTDLP_PATH="/home/runner/workspace/bin/yt-dlp-latest"
mkdir -p "$(dirname "$YTDLP_PATH")"
if [ ! -f "$YTDLP_PATH" ]; then
  echo "Downloading yt-dlp..."
  curl -L "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux" -o "$YTDLP_PATH"
  chmod +x "$YTDLP_PATH"
  echo "Done: $($YTDLP_PATH --version)"
else
  echo "yt-dlp already present: $($YTDLP_PATH --version)"
fi
