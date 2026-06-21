import { detectPlatform, isValidUrl } from "@/lib/video-utils";
import { useState, useRef } from "react";
import { Download, X, AlertCircle, Loader2, Film, Music } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { PLATFORMS } from "./platform-icons";

export { PLATFORMS };

export function HeroSection({
  onSubmit,
  isPending,
}: {
  onSubmit: (url: string, mediaType: "video" | "audio") => void;
  isPending: boolean;
}) {
  const [url, setUrl] = useState("");
  const [mediaType, setMediaType] = useState<"video" | "audio" | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const platformId = detectPlatform(url);
  const platform = PLATFORMS.find((p) => p.id === platformId);
  const isUrlValid = isValidUrl(url);
  const urlOk = url.length > 0 && isUrlValid && !!platformId;
  const showUrlError = url.length > 0 && (!isUrlValid || !platformId);
  const canDownload = urlOk && !!mediaType;

  const handleChipClick = () => {
    inputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => inputRef.current?.focus(), 300);
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text);
      inputRef.current?.focus();
    } catch {
      inputRef.current?.focus();
    }
  };

  const handleSubmit = () => {
    if (!canDownload || isPending || !mediaType) return;
    onSubmit(url, mediaType);
  };

  return (
    <section className="w-full pt-20 pb-16 px-4 text-center flex flex-col items-center">
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full glass mb-8"
      >
        <span className="text-xs font-bold tracking-wider text-white/90">
          ⚡ FREE • FAST • NO SIGNUP REQUIRED
        </span>
      </motion.div>

      <motion.h1
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, delay: 0.05 }}
        className="text-4xl md:text-6xl lg:text-7xl font-extrabold mb-6 max-w-5xl mx-auto leading-tight tracking-tight"
      >
        Download Videos From <br className="hidden md:block" />
        <span className="text-gradient">Any Platform</span>
      </motion.h1>

      <motion.p
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, delay: 0.1 }}
        className="text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto"
      >
        The fastest, most reliable video downloader. No watermarks, no
        registration, completely free.
      </motion.p>

      {/* Platform chips */}
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.25, delay: 0.14 }}
        className="flex flex-wrap justify-center gap-3 mb-10"
      >
        {PLATFORMS.map((p) => {
          const Icon = p.IconComponent;
          return (
            <button
              key={p.id}
              type="button"
              onClick={handleChipClick}
              className={`flex items-center gap-2 px-4 py-2 rounded-full glass border border-white/10 transition-all duration-300 ${p.hoverBorder} hover:scale-105 hover:bg-white/5 group`}
            >
              <Icon className="w-5 h-5 flex-shrink-0 transition-transform group-hover:scale-110" />
              <span className="text-sm font-semibold text-white">{p.name}</span>
            </button>
          );
        })}
      </motion.div>

      {/* Main Card */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.18 }}
        className="max-w-3xl mx-auto w-full glass rounded-3xl p-4 md:p-6 mb-8 shadow-2xl relative overflow-hidden"
      >
        <div className="absolute inset-0 bg-gradient-to-r from-primary/10 to-secondary/10 pointer-events-none" />

        {/* Step 1: URL Input */}
        <div className="relative mb-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-5 h-5 rounded-full bg-primary/80 text-white text-xs font-bold flex items-center justify-center shrink-0">1</span>
            <span className="text-sm font-semibold text-white/70">Download Now</span>
          </div>
          <div className="relative flex items-center">
            <input
              ref={inputRef}
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              placeholder="Paste YouTube, TikTok or Snapchat URL here..."
              className={`w-full bg-black/50 border-2 rounded-2xl px-4 py-4 text-white placeholder:text-white/40 focus:outline-none transition-all text-base shadow-inner ${url ? "pr-12" : "pr-24"} ${
                urlOk
                  ? "border-green-500/50 focus:border-green-500"
                  : showUrlError
                  ? "border-red-500/50 focus:border-red-500"
                  : "border-white/10 focus:border-primary/50"
              }`}
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {url ? (
                <button
                  type="button"
                  onClick={() => { setUrl(""); inputRef.current?.focus(); }}
                  className="text-white/50 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/10"
                >
                  <X className="w-4 h-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handlePaste}
                  className="flex items-center gap-1 text-white/70 hover:text-white transition-colors px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-sm font-semibold"
                >
                  Paste
                </button>
              )}
            </div>
          </div>
          {showUrlError && (
            <div className="mt-2 flex items-center gap-2 text-red-400 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>Please enter a valid YouTube, TikTok or Snapchat URL</span>
            </div>
          )}
          {urlOk && platform && (
            <div className="mt-2 flex items-center gap-2 text-green-400 text-sm">
              <platform.IconComponent className="w-4 h-4 shrink-0" />
              <span>{platform.name} URL detected ✓</span>
            </div>
          )}
        </div>

        {/* Step 2: Video or Audio selection */}
        <AnimatePresence>
          {urlOk && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="flex items-center gap-2 mb-3">
                <span className="w-5 h-5 rounded-full bg-primary/80 text-white text-xs font-bold flex items-center justify-center shrink-0">2</span>
                <span className="text-sm font-semibold text-white/70">What do you want to download?</span>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <button
                  type="button"
                  onClick={() => setMediaType("video")}
                  className={`flex flex-col items-center justify-center gap-2 py-5 rounded-2xl border-2 transition-all duration-200 font-semibold ${
                    mediaType === "video"
                      ? "bg-primary/20 border-primary text-white shadow-[0_0_20px_rgba(108,99,255,0.3)]"
                      : "bg-white/5 border-white/10 text-white/60 hover:border-white/30 hover:text-white hover:bg-white/10"
                  }`}
                >
                  <Film className={`w-8 h-8 ${mediaType === "video" ? "text-primary" : ""}`} />
                  <span className="text-base">Video</span>
                  <span className="text-xs text-white/40 font-normal">720p • 1080p • 1440p</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMediaType("audio")}
                  className={`flex flex-col items-center justify-center gap-2 py-5 rounded-2xl border-2 transition-all duration-200 font-semibold ${
                    mediaType === "audio"
                      ? "bg-secondary/20 border-secondary text-white shadow-[0_0_20px_rgba(78,205,196,0.3)]"
                      : "bg-white/5 border-white/10 text-white/60 hover:border-white/30 hover:text-white hover:bg-white/10"
                  }`}
                >
                  <Music className={`w-8 h-8 ${mediaType === "audio" ? "text-secondary" : ""}`} />
                  <span className="text-base">Audio Only</span>
                  <span className="text-xs text-white/40 font-normal">MP3 • High Quality</span>
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Download Button */}
        <button
          disabled={!canDownload || isPending}
          onClick={handleSubmit}
          className="w-full bg-gradient-primary hover-shimmer text-white px-8 py-4 rounded-2xl font-bold text-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-3 shadow-[0_0_20px_rgba(108,99,255,0.4)]"
        >
          {isPending ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Fetching...
            </>
          ) : (
            <>
              <Download className="w-5 h-5" />
              {!urlOk
                ? "Paste a URL above"
                : !mediaType
                ? "Select Video or Audio"
                : `Download ${mediaType === "video" ? "Video" : "Audio"} Now`}
            </>
          )}
        </button>
      </motion.div>

    </section>
  );
}
