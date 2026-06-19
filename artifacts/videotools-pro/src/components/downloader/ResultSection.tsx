import { useState } from "react";
import { useGetDownloadUrl } from "@workspace/api-client-react";
import { formatDuration, formatBytes, detectPlatform } from "@/lib/video-utils";
import { PLATFORMS } from "./platform-icons";
import { motion, AnimatePresence } from "framer-motion";
import { Download, Film, Music, AlertTriangle, RefreshCw, ImageDown } from "lucide-react";
import { VideoInfo } from "@workspace/api-client-react/src/generated/api.schemas";

export function ResultSection({
  info,
  error,
  isLoading,
  onReset,
  onRetry,
}: {
  info: VideoInfo | null;
  error: string | null;
  isLoading: boolean;
  onReset: () => void;
  onRetry?: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"video" | "audio">("video");
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
          const a = document.createElement("a");
          a.href = data.downloadUrl;
          a.download = data.filename || "download";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => setDownloadingFormatId(null), 3000);
        },
        onError: () => {
          setDownloadingFormatId(null);
        },
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

  const getDisplayThumbnail = (thumbnail: string | null, platform: string) => {
    if (!thumbnail) return null;
    if (platform === "Instagram" || thumbnail.includes("cdninstagram") || thumbnail.includes("fbcdn")) {
      return `/api/video/thumbnail?url=${encodeURIComponent(thumbnail)}`;
    }
    return thumbnail;
  };

  if (!isLoading && !info && !error) return null;

  const platform = info ? PLATFORMS.find((p) => p.id === detectPlatform(info.url)) : null;

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
            className="glass border-red-500/30 bg-red-500/5 rounded-3xl p-8 flex flex-col items-center justify-center text-center shadow-xl"
          >
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
          </motion.div>
        )}

        {info && !isLoading && (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass rounded-3xl overflow-hidden shadow-2xl"
          >
            {/* Platform + Title + Uploader Header */}
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
              <div className="flex flex-col gap-0.5 min-w-0">
                {info.uploader && (
                  <span className="text-sm font-semibold text-primary/90 leading-tight truncate">
                    @{info.uploader}
                  </span>
                )}
                <h3 className="text-base font-bold text-white line-clamp-2 leading-snug">
                  {info.title}
                </h3>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-5 gap-0">
              {/* Left Column: Thumbnail */}
              <div className="md:col-span-2 p-6 bg-white/5 md:border-r border-white/5">
                <div className="relative rounded-xl overflow-hidden aspect-video bg-black mb-4 shadow-lg">
                  {info.thumbnail ? (
                    <img
                      src={getDisplayThumbnail(info.thumbnail, info.platform)}
                      alt={info.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-white/20 text-sm">
                      No Thumbnail
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

              {/* Right Column: Download Options */}
              <div className="md:col-span-3 p-6 flex flex-col">
                <div className="flex bg-white/5 rounded-xl p-1 mb-5">
                  <button
                    onClick={() => setActiveTab("video")}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-colors ${activeTab === "video" ? "bg-primary text-white shadow-md" : "text-white/60 hover:text-white"}`}
                  >
                    <Film className="w-4 h-4" /> Video
                  </button>
                  <button
                    onClick={() => setActiveTab("audio")}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-colors ${activeTab === "audio" ? "bg-secondary text-white shadow-md" : "text-white/60 hover:text-white"}`}
                  >
                    <Music className="w-4 h-4" /> Audio
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar space-y-3 max-h-[360px]">
                  {info.formats
                    .filter((f) => f.type === activeTab)
                    .map((format, i) => {
                      const sizeStr =
                        format.type === "video"
                          ? formatBytes(format.filesize)
                          : (() => {
                              const m = format.formatId.match(/:audio:(\d+)$/);
                              if (!m || !info.duration) return null;
                              const mb = (info.duration * parseInt(m[1])) / 8 / 1024;
                              return mb < 1 ? `~${Math.round(mb * 1024)} KB` : `~${mb.toFixed(0)} MB`;
                            })();
                      return (
                        <div
                          key={i}
                          className="flex items-center justify-between p-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 transition-colors"
                        >
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-white text-lg">{format.quality}</span>
                              {format.badge && (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wider bg-white/10 text-white/70 uppercase">
                                  {format.badge}
                                </span>
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {sizeStr ? (
                                <span className="text-white/60 font-medium">{sizeStr}</span>
                              ) : null}
                              {sizeStr ? " • " : ""}
                              {format.label}
                            </span>
                          </div>
                          <button
                            onClick={() => handleDownload(info.url, format.formatId)}
                            disabled={!!downloadingFormatId}
                            className="flex items-center justify-center w-12 h-12 rounded-xl bg-green-500/20 text-green-400 hover:bg-green-500 hover:text-white transition-all shadow-[0_0_10px_rgba(34,197,94,0.2)] hover:shadow-[0_0_20px_rgba(34,197,94,0.4)] disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                          >
                            {downloadingFormatId === format.formatId ? (
                              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                              <Download className="w-5 h-5" />
                            )}
                          </button>
                        </div>
                      );
                    })}

                  {info.formats.filter((f) => f.type === activeTab).length === 0 && (
                    <div className="text-center py-12 text-muted-foreground text-sm">
                      No {activeTab} formats available for this video.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
