import { useState, useRef } from "react";
import { useGetVideoInfo } from "@workspace/api-client-react";
import { VideoInfo } from "@workspace/api-client-react/src/generated/api.schemas";
import { ResultSection } from "@/components/downloader/ResultSection";
import { Music, CheckCircle2, X, Loader2, Download, AlertCircle } from "lucide-react";
import { motion } from "framer-motion";
import { useSeoMeta } from "@/lib/useSeoMeta";

function isTikTokUrl(url: string) {
  return /tiktok\.com|vm\.tiktok|vt\.tiktok/i.test(url);
}

export default function TikTokMp3() {
  useSeoMeta({
    title: "TikTok to MP3 Converter — Download TikTok Audio Free | VideoTools Pro",
    description: "Convert any TikTok video to MP3 audio instantly. Free TikTok MP3 downloader — no watermark, no login, high quality audio. Works on mobile & PC.",
    canonical: "https://videotoolspro.replit.app/download-tiktok-mp3",
    ogTitle: "TikTok to MP3 — Free TikTok Audio Downloader | VideoTools Pro",
    ogDescription: "Download TikTok audio as MP3 for free. No watermark, no login needed. Fast & secure TikTok MP3 converter online.",
  });
  const getVideoInfo = useGetVideoInfo();
  const [videoData, setVideoData] = useState<VideoInfo | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [lastUrl, setLastUrl] = useState("");
  const [url, setUrl] = useState("");
  const [showUrlError, setShowUrlError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const urlOk = isTikTokUrl(url);

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text);
      setShowUrlError(false);
    } catch {}
  };

  const fetchInfo = (submitUrl: string) => {
    if (!isTikTokUrl(submitUrl)) { setShowUrlError(true); return; }
    setShowUrlError(false);
    setVideoData(null);
    setErrorMsg(null);
    setErrorCode(null);
    setLastUrl(submitUrl);
    getVideoInfo.mutate(
      { data: { url: submitUrl, mediaType: "audio" } },
      {
        onSuccess: (data) => setVideoData(data),
        onError: (err: any) => {
          setErrorCode(err?.response?.data?.errorCode || null);
          setErrorMsg(err?.response?.data?.error || "Failed to fetch. Check the URL and try again.");
        },
      }
    );
  };

  const steps = [
    "TikTok app mein video open karo",
    "Share → Copy Link tap karo",
    "Woh link yahan paste karo",
    "Download MP3 click karo — done!",
  ];

  const faqs = [
    {
      q: "TikTok MP3 download karne ka tarika kya hai?",
      a: "TikTok pe video open karo, Share → Copy Link tap karo. Woh link upar paste karo aur Download MP3 click karo. Turant download ho jaayega.",
    },
    {
      q: "TikTok audio quality kaisi hoti hai?",
      a: "Hum TikTok ka original audio track extract karte hain — koi quality loss nahi. Jo quality TikTok pe hai wahi milegi.",
    },
    {
      q: "Kya bilkul free hai?",
      a: "Haan, 100% free. Koi account nahi, koi limit nahi, koi paisa nahi.",
    },
    {
      q: "Mobile pe kaam karta hai?",
      a: "Haan, iPhone aur Android dono pe perfectly kaam karta hai browser mein.",
    },
  ];

  return (
    <div className="flex flex-col w-full">
      <section className="w-full pt-20 pb-16 px-4 text-center flex flex-col items-center">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full glass mb-8"
        >
          <Music className="w-4 h-4 text-primary" />
          <span className="text-xs font-bold tracking-wider text-white/90">
            TIKTOK → MP3 • FREE • NO WATERMARK
          </span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="text-4xl md:text-6xl lg:text-7xl font-extrabold mb-6 max-w-4xl mx-auto leading-tight tracking-tight"
        >
          TikTok MP3{" "}
          <span className="text-gradient">Downloader</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto"
        >
          TikTok videos se directly MP3 audio extract karo — watermark-free, free, instant.
        </motion.p>

        {/* Main Card — same as home */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="max-w-3xl mx-auto w-full glass rounded-3xl p-4 md:p-6 mb-8 shadow-2xl relative overflow-hidden"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-primary/10 to-secondary/10 pointer-events-none" />

          <div className="relative mb-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-5 h-5 rounded-full bg-primary/80 text-white text-xs font-bold flex items-center justify-center shrink-0">1</span>
              <span className="text-sm font-semibold text-white/70">TikTok URL Paste Karo</span>
            </div>
            <div className="relative flex items-center">
              <input
                ref={inputRef}
                type="text"
                value={url}
                onChange={(e) => { setUrl(e.target.value); setShowUrlError(false); }}
                onKeyDown={(e) => e.key === "Enter" && fetchInfo(url)}
                placeholder="Paste TikTok video URL here..."
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
                <span>Please enter a valid TikTok URL</span>
              </div>
            )}
          </div>

          <button
            disabled={!urlOk || getVideoInfo.isPending}
            onClick={() => fetchInfo(url)}
            className="w-full bg-gradient-primary hover-shimmer text-white px-8 py-4 rounded-2xl font-bold text-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-3 shadow-[0_0_20px_rgba(108,99,255,0.4)]"
          >
            {getVideoInfo.isPending ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Extracting...
              </>
            ) : (
              <>
                <Music className="w-5 h-5" />
                Download MP3
              </>
            )}
          </button>
        </motion.div>
      </section>

      <div id="result-section">
        <ResultSection
          info={videoData}
          error={errorMsg}
          errorCode={errorCode}
          isLoading={getVideoInfo.isPending}
          mediaType="audio"
          onReset={() => { setVideoData(null); setErrorMsg(null); setErrorCode(null); setLastUrl(""); setUrl(""); }}
          onRetry={lastUrl ? () => fetchInfo(lastUrl) : undefined}
        />
      </div>

      <section className="py-16 px-4 border-t border-white/10">
        <div className="container mx-auto max-w-4xl">
          <h2 className="text-2xl md:text-3xl font-bold text-white text-center mb-10">
            4 Steps Mein TikTok MP3 Download Karo
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
            {steps.map((step, i) => (
              <div key={i} className="glass rounded-2xl p-6 flex flex-col items-center text-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-lg">
                  {i + 1}
                </div>
                <p className="text-white/80 text-sm leading-relaxed">{step}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 px-4 border-t border-white/10">
        <div className="container mx-auto max-w-3xl">
          <h2 className="text-2xl md:text-3xl font-bold text-white text-center mb-10">
            Aksar Pooche Jaane Wale Sawal
          </h2>
          <div className="flex flex-col gap-4">
            {faqs.map((faq, i) => (
              <div key={i} className="glass rounded-2xl p-6">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-white font-semibold mb-2">{faq.q}</h3>
                    <p className="text-white/60 text-sm leading-relaxed">{faq.a}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
