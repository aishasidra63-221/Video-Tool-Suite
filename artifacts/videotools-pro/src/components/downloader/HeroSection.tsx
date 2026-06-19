import { detectPlatform, isValidUrl } from "@/lib/video-utils";
import { useState, useRef } from "react";
import { Download, X, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { PLATFORMS } from "./platform-icons";

export { PLATFORMS };

export function HeroSection({ onSubmit, isPending }: { onSubmit: (url: string) => void, isPending: boolean }) {
  const [url, setUrl] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const platformId = detectPlatform(url);
  const platform = PLATFORMS.find(p => p.id === platformId);
  const isUrlValid = isValidUrl(url);
  const showSuccess = url.length > 0 && isUrlValid && !!platformId;
  const showError = url.length > 0 && (!isUrlValid || !platformId);

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
    if (!url || isPending) return;
    onSubmit(url);
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
            <input
              ref={inputRef}
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              placeholder="Paste video URL here... (YouTube, TikTok, Instagram...)"
              className={`w-full bg-black/50 border-2 rounded-2xl px-4 py-5 md:py-6 text-white placeholder:text-white/40 focus:outline-none transition-all text-lg shadow-inner pl-6 ${url ? 'pr-14' : 'pr-28'} ${
                showSuccess ? 'border-green-500/50 focus:border-green-500' :
                showError   ? 'border-red-500/50 focus:border-red-500' :
                              'border-white/10 focus:border-primary/50'
              }`}
            />

            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {url ? (
                <button
                  type="button"
                  onClick={() => { setUrl(""); inputRef.current?.focus(); }}
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
            onClick={handleSubmit}
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
        {showSuccess && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-3 text-left px-2 flex items-center gap-2 text-green-400">
            <CheckCircle2 className="w-4 h-4" />
            <span className="text-sm">{platform?.name} URL detected — ready to download!</span>
          </motion.div>
        )}
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="flex flex-wrap justify-center gap-3"
      >
        {/* Badge 1: No Sign-up */}
        <div className="group flex items-center gap-2.5 px-5 py-2.5 rounded-2xl bg-gradient-to-br from-violet-500/10 to-purple-500/5 border border-violet-500/20 hover:border-violet-400/40 transition-all duration-300 hover:scale-105 shadow-[0_0_12px_rgba(139,92,246,0.08)]">
          <span className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg bg-violet-500/20 group-hover:bg-violet-500/30 transition-colors">
            <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4 text-violet-400" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 2a4 4 0 100 8 4 4 0 000-8z"/>
              <path d="M3 18c0-3.314 3.134-6 7-6s7 2.686 7 6"/>
              <path d="M14 11l1.5 1.5L18 10" strokeWidth="1.8"/>
            </svg>
          </span>
          <div className="flex flex-col leading-tight">
            <span className="text-xs font-bold text-white tracking-wide">No Sign-up</span>
            <span className="text-[10px] text-white/50 font-medium">100% Free Forever</span>
          </div>
        </div>

        {/* Badge 2: Downloads count */}
        <div className="group flex items-center gap-2.5 px-5 py-2.5 rounded-2xl bg-gradient-to-br from-emerald-500/10 to-teal-500/5 border border-emerald-500/20 hover:border-emerald-400/40 transition-all duration-300 hover:scale-105 shadow-[0_0_12px_rgba(16,185,129,0.08)]">
          <span className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg bg-emerald-500/20 group-hover:bg-emerald-500/30 transition-colors">
            <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4 text-emerald-400" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 3v10M6 9l4 4 4-4"/>
              <path d="M4 16h12"/>
            </svg>
          </span>
          <div className="flex flex-col leading-tight">
            <span className="text-xs font-bold text-white tracking-wide">2.4M+ Downloads</span>
            <span className="text-[10px] text-white/50 font-medium">Trusted by millions</span>
          </div>
        </div>

        {/* Badge 3: Safe & Secure */}
        <div className="group flex items-center gap-2.5 px-5 py-2.5 rounded-2xl bg-gradient-to-br from-sky-500/10 to-blue-500/5 border border-sky-500/20 hover:border-sky-400/40 transition-all duration-300 hover:scale-105 shadow-[0_0_12px_rgba(14,165,233,0.08)]">
          <span className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg bg-sky-500/20 group-hover:bg-sky-500/30 transition-colors">
            <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4 text-sky-400" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 2l6 2.5v5c0 3.5-2.5 6-6 7.5C4.5 15.5 2 13 2 9.5v-5L10 2z"/>
              <path d="M7 10l2 2 4-4"/>
            </svg>
          </span>
          <div className="flex flex-col leading-tight">
            <span className="text-xs font-bold text-white tracking-wide">Safe & Secure</span>
            <span className="text-[10px] text-white/50 font-medium">No malware, no ads</span>
          </div>
        </div>
      </motion.div>
    </section>
  );
}
