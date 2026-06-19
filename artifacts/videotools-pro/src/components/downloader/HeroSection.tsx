import { detectPlatform, isValidUrl } from "@/lib/video-utils";
import { useState, useRef, useEffect, useCallback } from "react";
import { Download, X, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { PLATFORMS } from "./platform-icons";

export { PLATFORMS };

export function HeroSection({ onSubmit, isPending }: { onSubmit: (url: string) => void, isPending: boolean }) {
  const [url, setUrl] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSubmittedRef = useRef<string>("");

  const platformId = detectPlatform(url);
  const platform = PLATFORMS.find(p => p.id === platformId);
  const isUrlValid = isValidUrl(url);
  const showSuccess = url.length > 0 && isUrlValid && !!platformId;
  const showError = url.length > 0 && (!isUrlValid || !platformId);

  const tryAutoSubmit = useCallback((value: string, immediate = false) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!isValidUrl(value) || !detectPlatform(value)) return;
    if (value === lastSubmittedRef.current) return;

    const delay = immediate ? 0 : 700;
    debounceRef.current = setTimeout(() => {
      if (value === lastSubmittedRef.current) return;
      lastSubmittedRef.current = value;
      onSubmit(value);
      // Scroll to result section smoothly
      setTimeout(() => {
        document.getElementById("result-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }, delay);
  }, [onSubmit]);

  useEffect(() => {
    if (!isPending) {
      tryAutoSubmit(url);
    }
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [url]);

  const handleChipClick = () => {
    inputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => inputRef.current?.focus(), 300);
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text);
      inputRef.current?.focus();
      // Trigger immediately on paste button — no debounce
      tryAutoSubmit(text, true);
    } catch {
      inputRef.current?.focus();
    }
  };

  const handleChange = (value: string) => {
    setUrl(value);
    if (value !== lastSubmittedRef.current) {
      lastSubmittedRef.current = "";
    }
  };

  const handleManualSubmit = () => {
    if (!url || isPending) return;
    lastSubmittedRef.current = url;
    onSubmit(url);
    setTimeout(() => {
      document.getElementById("result-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  };

  return (
    <section className="w-full pt-20 pb-16 px-4 text-center flex flex-col items-center">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full glass mb-8"
      >
        <span className="text-xs font-bold tracking-wider text-white/90">⚡ FREE • FAST • NO SIGNUP REQUIRED</span>
      </motion.div>

      <motion.h1
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="text-4xl md:text-6xl lg:text-7xl font-extrabold mb-6 max-w-5xl mx-auto leading-tight tracking-tight"
      >
        Download Videos From <br className="hidden md:block" />
        <span className="text-gradient">Any Platform</span>
      </motion.h1>

      <motion.p
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto"
      >
        The fastest, most reliable video downloader. No watermarks, no registration, completely free.
      </motion.p>

      {/* Platform chips */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.3 }}
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

      {/* URL Input */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="max-w-3xl mx-auto w-full glass rounded-3xl p-3 md:p-5 mb-8 shadow-2xl relative overflow-hidden"
      >
        <div className="absolute inset-0 bg-gradient-to-r from-primary/10 to-secondary/10 pointer-events-none" />
        <div className="relative flex flex-col md:flex-row items-center gap-3">
          <div className="relative w-full flex-1">
            {platform && (() => {
              const Icon = platform.IconComponent;
              return (
                <div className="absolute left-4 top-1/2 -translate-y-1/2 flex items-center justify-center">
                  <Icon className="w-7 h-7" />
                </div>
              );
            })()}

            <input
              ref={inputRef}
              type="text"
              value={url}
              onChange={(e) => handleChange(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && url && !isPending && handleManualSubmit()}
              onPaste={(e) => {
                const pasted = e.clipboardData.getData("text");
                handleChange(pasted);
                tryAutoSubmit(pasted, true);
              }}
              placeholder="Paste video URL here... (YouTube, TikTok, Instagram...)"
              className={`w-full bg-black/50 border-2 rounded-2xl px-4 py-5 md:py-6 text-white placeholder:text-white/40 focus:outline-none transition-all text-lg shadow-inner ${platform ? 'pl-14' : 'pl-6'} ${url ? 'pr-14' : 'pr-28'} ${
                isPending && showSuccess ? 'border-primary/60 focus:border-primary animate-pulse' :
                showSuccess ? 'border-green-500/50 focus:border-green-500' :
                showError   ? 'border-red-500/50 focus:border-red-500' :
                              'border-white/10 focus:border-primary/50'
              }`}
            />

            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {url ? (
                <button
                  type="button"
                  onClick={() => { setUrl(""); lastSubmittedRef.current = ""; inputRef.current?.focus(); }}
                  className="text-white/50 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/10"
                  title="Clear"
                >
                  <X className="w-5 h-5" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handlePaste}
                  className="flex items-center gap-1.5 text-white/70 hover:text-white transition-colors px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-sm font-semibold"
                  title="Paste URL"
                >
                  Paste
                </button>
              )}
            </div>
          </div>

          <button
            disabled={!url || isPending}
            onClick={handleManualSubmit}
            className="w-full md:w-auto bg-gradient-primary hover-shimmer text-white px-8 py-5 md:py-6 rounded-2xl font-bold text-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 shrink-0 shadow-[0_0_20px_rgba(108,99,255,0.4)]"
          >
            {isPending ? (
              <Loader2 className="w-6 h-6 animate-spin" />
            ) : (
              <>
                <Download className="w-6 h-6" />
                Download Now
              </>
            )}
          </button>
        </div>

        {showError && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-3 text-left px-2 flex items-center gap-2 text-red-400">
            <AlertCircle className="w-4 h-4" />
            <span className="text-sm">Please enter a valid supported URL (YouTube, TikTok, Instagram, Facebook, Snapchat, Twitter/X)</span>
          </motion.div>
        )}
        {showSuccess && !isPending && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-3 text-left px-2 flex items-center gap-2 text-green-400">
            <CheckCircle2 className="w-4 h-4" />
            <span className="text-sm">{platform?.name} URL detected — fetching info automatically...</span>
          </motion.div>
        )}
        {isPending && showSuccess && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-3 text-left px-2 flex items-center gap-2 text-primary">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Fetching video info from {platform?.name}...</span>
          </motion.div>
        )}
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="flex flex-wrap justify-center gap-2"
      >
        {[
          { emoji: "📥", label: "2.4M+ Downloads" },
          { emoji: "⭐", label: "4.9/5 Rating" },
          { emoji: "🔒", label: "100% Safe" },
          { emoji: "🌐", label: "6 Platforms" },
        ].map((b) => (
          <span
            key={b.label}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/8 border border-white/10 text-xs font-semibold text-white/70"
          >
            <span>{b.emoji}</span>
            {b.label}
          </span>
        ))}
      </motion.div>
    </section>
  );
}
