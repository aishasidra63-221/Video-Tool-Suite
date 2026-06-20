import { useState, useRef } from "react";
import { useGetDownloadUrl } from "@workspace/api-client-react";
import { formatDuration, formatBytes, detectPlatform } from "@/lib/video-utils";
import { PLATFORMS } from "./platform-icons";
import { motion, AnimatePresence } from "framer-motion";
import { Download, AlertTriangle, RefreshCw, ImageDown, Image, Film, Music } from "lucide-react";
import { VideoInfo } from "@workspace/api-client-react/src/generated/api.schemas";

function SmartThumbnail({ src, alt, platform }: { src: string; alt: string; platform: string }) {
  const [stage, setStage] = useState<"direct" | "proxy" | "failed">("direct");
  const triedProxy = useRef(false);
  const proxyUrl = `/api/video/thumbnail?url=${encodeURIComponent(src)}`;
  const displaySrc = stage === "direct" ? src : stage === "proxy" ? proxyUrl : null;

  const handleError = () => {
    if (stage === "direct" && !triedProxy.current) {
      triedProxy.current = true;
      setStage("proxy");
    } else {
      setStage("failed");
    }
  };

  if (stage === "failed" || !displaySrc) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-white/20">
        <Image className="w-10 h-10" />
        <span className="text-xs">No thumbnail</span>
      </div>
    );
  }

  return (
    <img
      key={displaySrc}
      src={displaySrc}
      alt={alt}
      className="w-full h-full object-cover"
      onError={handleError}
    />
  );
}

function getFilteredFormats(
  formats: VideoInfo["formats"],
  mediaType: "video" | "audio"
) {
  if (mediaType === "audio") {
    return formats.filter((f) => f.type === "audio").slice(0, 2);
  }

  const videoFormats = formats.filter((f) => f.type === "video");

  const PREFERRED = ["1440p", "1080p", "720p"];
  const preferred = PREFERRED.map((q) =>
    videoFormats.find(
      (f) =>
        f.quality === q ||
        f.quality.startsWith(q.replace("p", "")) ||
        f.label?.toLowerCase().includes(q.replace("p", ""))
    )
  ).filter(Boolean) as VideoInfo["formats"];

  if (preferred.length >= 2) return preferred;

  return videoFormats.slice(0, 3);
}

export function ResultSection({
  info,
  error,
  errorCode,
  isLoading,
  mediaType,
  onReset,
  onRetry,
}: {
  info: VideoInfo | null;
  error: string | null;
  errorCode?: string | null;
  isLoading: boolean;
  mediaType: "video" | "audio";
  onReset: () => void;
  onRetry?: () => void;
}) {
  const [downloadingFormatId, setDownloadingFormatId] = useState<string | null>(null);
  const [downloadingThumb, setDownloadingThumb] = useState(false);
  const getDownloadUrl = useGetDownloadUrl();

  const handleDownload = (url: string, formatId: string) => {
    if (downloadingFormatId) return;
    setDownloadingFormatId(formatId);
    getDownloadUrl.mutate(
      { data: { url, formatId } },
      {
        onSuccess: (data) => {
          window.location.href = data.downloadUrl;
          setTimeout(() => setDownloadingFormatId(null), 4000);
        },
        onError: () => setDownloadingFormatId(null),
      }
    );
  };

  const handleThumbnailDownload = (url: string) => {
    if (!url || downloadingThumb) return;
    setDownloadingThumb(true);
    const proxyUrl = `/api/video/thumbnail?url=${encodeURIComponent(url)}&download=true`;
    const a = document.createElement("a");
    a.href = proxyUrl;
    a.download = "thumbnail.jpg";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => setDownloadingThumb(false), 3000);
  };

  if (!isLoading && !info && !error) return null;

  const platform = info ? PLATFORMS.find((p) => p.id === detectPlatform(info.url)) : null;
  const displayFormats = info ? getFilteredFormats(info.formats, mediaType) : [];

  return (
    <section className="w-full max-w-4xl mx-auto px-4 pb-20">
      <AnimatePresence mode="wait">
        {isLoading && (
          <motion.div
            key="loading"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="glass rounded-3xl p-12 flex flex-col items-center justify-center text-center shadow-xl"
          >
            <div className="w-16 h-16 border-4 border-primary/30 border-t-primary rounded-full animate-spin mb-6" />
            <h3 className="text-xl font-bold text-white mb-2">Fetching video info...</h3>
            <p className="text-muted-foreground">This usually takes just a few seconds.</p>
          </motion.div>
        )}

        {error && !isLoading && (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className={`glass rounded-3xl p-8 flex flex-col items-center justify-center text-center shadow-xl ${
              errorCode === "SERVER_BUSY"
                ? "border-yellow-500/30 bg-yellow-500/5"
                : "border-red-500/30 bg-red-500/5"
            }`}
          >
            {errorCode === "SERVER_BUSY" ? (
              <>
                <div className="w-16 h-16 flex items-center justify-center rounded-full bg-yellow-500/20 mb-4">
                  <RefreshCw className="w-8 h-8 text-yellow-400 animate-spin" style={{ animationDuration: "2s" }} />
                </div>
                <h3 className="text-2xl font-bold text-white mb-2">Server Busy ⏳</h3>
                <p className="text-yellow-200 mb-8 max-w-md">{error}</p>
                {onRetry && (
                  <button
                    onClick={onRetry}
                    className="flex items-center gap-2 bg-yellow-500/80 hover:bg-yellow-500 text-white px-6 py-3 rounded-xl font-semibold transition-colors shadow"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Dobara Try Karo
                  </button>
                )}
              </>
            ) : errorCode === "TIKTOK_PROFILE_URL" || errorCode === "TIKTOK_NO_VIDEO_ID" ? (
              <>
                <div className="w-16 h-16 flex items-center justify-center rounded-full bg-[#010101] border-2 border-white/10 mb-4 text-3xl">
                  🎵
                </div>
                <h3 className="text-2xl font-bold text-white mb-1">Wrong TikTok Link</h3>
                <p className="text-red-300 mb-6 max-w-sm text-sm">
                  Yeh profile ka link hai — VIDEO ka link chahiye.
                </p>
                <div className="w-full max-w-sm bg-white/5 border border-white/10 rounded-2xl p-4 mb-6 text-left">
                  <p className="text-white/60 text-xs uppercase tracking-wider mb-3 font-semibold">Sahi link kaise lein</p>
                  <div className="space-y-3">
                    {[
                      { step: "1", text: "TikTok app kholo" },
                      { step: "2", text: "Jo video download karni hai woh open karo" },
                      { step: "3", text: "Share button dabao (arrow icon)" },
                      { step: "4", text: '"Copy Link" tap karo' },
                      { step: "5", text: "Woh link yahan paste karo" },
                    ].map(({ step, text }) => (
                      <div key={step} className="flex items-center gap-3">
                        <span className="w-6 h-6 rounded-full bg-primary/80 text-white text-xs font-bold flex items-center justify-center shrink-0">{step}</span>
                        <span className="text-white/80 text-sm">{text}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 pt-3 border-t border-white/10">
                    <p className="text-white/40 text-xs mb-1">Sahi URL ka format:</p>
                    <code className="text-green-400 text-xs break-all">tiktok.com/@username/video/1234567890</code>
                  </div>
                </div>
                <button
                  onClick={onReset}
                  className="flex items-center gap-2 bg-primary/80 hover:bg-primary text-white px-6 py-3 rounded-xl font-semibold transition-colors shadow"
                >
                  Naya Link Paste Karo
                </button>
              </>
            ) : (
              <>
                <AlertTriangle className="w-16 h-16 text-red-500 mb-4" />
                <h3 className="text-2xl font-bold text-white mb-2">Something went wrong</h3>
                <p className="text-red-200 mb-8 max-w-md">{error}</p>
                <div className="flex items-center gap-3 flex-wrap justify-center">
                  {onRetry && (
                    <button
                      onClick={onRetry}
                      className="flex items-center gap-2 bg-primary/80 hover:bg-primary text-white px-6 py-3 rounded-xl font-semibold transition-colors shadow"
                    >
                      <RefreshCw className="w-4 h-4" />
                      Try Again
                    </button>
                  )}
                  <button
                    onClick={onReset}
                    className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white px-6 py-3 rounded-xl font-medium transition-colors"
                  >
                    Try Another URL
                  </button>
                </div>
              </>
            )}
          </motion.div>
        )}

        {info && !isLoading && (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass rounded-3xl overflow-hidden shadow-2xl"
          >
            {/* Platform + Title Header */}
            <div className="flex items-start gap-3 px-6 pt-6 pb-4 border-b border-white/10">
              {platform ? (
                <div
                  className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold shrink-0 mt-0.5"
                  style={{ background: `${platform.color}22`, border: `1px solid ${platform.color}55` }}
                >
                  <platform.IconComponent className="w-4 h-4" style={{ color: platform.color }} />
                  <span style={{ color: platform.color }}>{platform.name}</span>
                </div>
              ) : (
                <div className="px-3 py-1.5 rounded-full bg-white/10 text-xs font-bold text-white/80 shrink-0 mt-0.5">
                  {info.platform}
                </div>
              )}
              <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                {info.uploader && (
                  <span className="text-sm font-semibold text-primary/90 leading-tight truncate">
                    @{info.uploader}
                  </span>
                )}
                <h3 className="text-base font-bold text-white line-clamp-2 leading-snug">
                  {info.title}
                </h3>
              </div>
              {/* Media type badge */}
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold shrink-0 ${
                mediaType === "video"
                  ? "bg-primary/20 text-primary border border-primary/30"
                  : "bg-secondary/20 text-secondary border border-secondary/30"
              }`}>
                {mediaType === "video" ? <Film className="w-3.5 h-3.5" /> : <Music className="w-3.5 h-3.5" />}
                {mediaType === "video" ? "Video" : "Audio"}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-5 gap-0">
              {/* Left: Thumbnail */}
              <div className="md:col-span-2 p-6 bg-white/5 md:border-r border-white/5">
                <div className="relative rounded-xl overflow-hidden aspect-video bg-black mb-4 shadow-lg">
                  {info.thumbnail ? (
                    <SmartThumbnail
                      src={info.thumbnail}
                      alt={info.title}
                      platform={info.platform}
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-white/20">
                      <Image className="w-10 h-10" />
                      <span className="text-xs">No Thumbnail</span>
                    </div>
                  )}
                  {info.duration && (
                    <div className="absolute bottom-2 right-2 bg-black/80 backdrop-blur text-white text-xs font-mono px-2 py-1 rounded">
                      {formatDuration(info.duration)}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => handleThumbnailDownload(info.thumbnail || "")}
                  disabled={!info.thumbnail || downloadingThumb}
                  className="w-full flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 text-white px-4 py-2.5 rounded-xl font-medium transition-colors text-sm disabled:opacity-50"
                >
                  {downloadingThumb ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <ImageDown className="w-4 h-4" />
                  )}
                  {downloadingThumb ? "Downloading..." : "Download Thumbnail"}
                </button>
              </div>

              {/* Right: Download Options */}
              <div className="md:col-span-3 p-6 flex flex-col">
                <div className="flex items-center gap-2 mb-5">
                  {mediaType === "video" ? (
                    <Film className="w-5 h-5 text-primary" />
                  ) : (
                    <Music className="w-5 h-5 text-secondary" />
                  )}
                  <h4 className="text-base font-bold text-white">
                    {mediaType === "video" ? "Video Quality" : "Audio Quality"}
                  </h4>
                </div>

                <div className="space-y-3">
                  {displayFormats.length > 0 ? (
                    displayFormats.map((format, i) => {
                      const sizeStr =
                        format.type === "video"
                          ? formatBytes(format.filesize)
                          : (() => {
                              const m = format.formatId.match(/:audio:(\d+)$/);
                              if (!m || !info.duration) return null;
                              const mb = (info.duration * parseInt(m[1])) / 8 / 1024;
                              return mb < 1 ? `~${Math.round(mb * 1024)} KB` : `~${mb.toFixed(0)} MB`;
                            })();

                      const isDownloading = downloadingFormatId === format.formatId;

                      return (
                        <motion.div
                          key={i}
                          initial={{ opacity: 0, x: 10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.07 }}
                          className="flex items-center justify-between p-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 transition-colors"
                        >
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-white text-xl">{format.quality}</span>
                              {format.badge && (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wider bg-white/10 text-white/70 uppercase">
                                  {format.badge}
                                </span>
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {sizeStr && <span className="text-white/60 font-medium">{sizeStr} • </span>}
                              {format.label}
                            </span>
                          </div>
                          <button
                            onClick={() => handleDownload(info.url, format.formatId)}
                            disabled={!!downloadingFormatId}
                            className={`flex items-center justify-center w-12 h-12 rounded-xl transition-all shadow disabled:opacity-50 disabled:cursor-not-allowed shrink-0 ${
                              mediaType === "video"
                                ? "bg-green-500/20 text-green-400 hover:bg-green-500 hover:text-white shadow-[0_0_10px_rgba(34,197,94,0.2)] hover:shadow-[0_0_20px_rgba(34,197,94,0.4)]"
                                : "bg-secondary/20 text-secondary hover:bg-secondary hover:text-white shadow-[0_0_10px_rgba(78,205,196,0.2)] hover:shadow-[0_0_20px_rgba(78,205,196,0.4)]"
                            }`}
                          >
                            {isDownloading ? (
                              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                              <Download className="w-5 h-5" />
                            )}
                          </button>
                        </motion.div>
                      );
                    })
                  ) : (
                    <div className="text-center py-12 text-muted-foreground text-sm">
                      No {mediaType} formats available for this video.
                    </div>
                  )}
                </div>

                <button
                  onClick={onReset}
                  className="mt-6 text-sm text-white/40 hover:text-white/70 transition-colors underline underline-offset-2 text-center"
                >
                  ← Download another video
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
