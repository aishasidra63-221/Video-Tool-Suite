import { useState } from "react";
import { useGetVideoInfo } from "@workspace/api-client-react";
import { VideoInfo } from "@workspace/api-client-react/src/generated/api.schemas";
import { ResultSection } from "@/components/downloader/ResultSection";
import { Music, CheckCircle2 } from "lucide-react";
import { motion } from "framer-motion";

function MiniInput({
  onSubmit,
  isPending,
}: {
  onSubmit: (url: string) => void;
  isPending: boolean;
}) {
  const [url, setUrl] = useState("");

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text);
    } catch {}
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="relative flex items-center gap-2">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && url && onSubmit(url)}
          placeholder="Paste TikTok video URL here..."
          className="w-full bg-black/50 border-2 border-white/10 focus:border-primary/60 rounded-2xl px-4 py-4 text-white placeholder:text-white/40 focus:outline-none transition-all text-base"
        />
        {!url && (
          <button
            onClick={handlePaste}
            className="absolute right-[110px] text-xs text-white/50 hover:text-white/80 transition-colors"
          >
            Paste
          </button>
        )}
        <button
          onClick={() => url && onSubmit(url)}
          disabled={!url || isPending}
          className="shrink-0 px-6 py-4 rounded-2xl bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold transition-all"
        >
          {isPending ? "..." : "Extract MP3"}
        </button>
      </div>
    </div>
  );
}

export default function TikTokMp3() {
  const getVideoInfo = useGetVideoInfo();
  const [videoData, setVideoData] = useState<VideoInfo | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [lastUrl, setLastUrl] = useState("");

  const fetchInfo = (url: string) => {
    setVideoData(null);
    setErrorMsg(null);
    setErrorCode(null);
    setLastUrl(url);
    getVideoInfo.mutate(
      { data: { url, mediaType: "audio" } },
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
    "Open TikTok aur video par jaao",
    "Share button tap karo → Copy Link",
    "Woh link yahan paste karo",
    "Extract MP3 click karo — ho gaya!",
  ];

  const faqs = [
    {
      q: "TikTok MP3 download karne ka tarika kya hai?",
      a: "TikTok pe video open karo, Share → Copy Link tap karo. Woh link upar input mein paste karo aur Extract MP3 click karo. Tumhara MP3 turant download ho jaayega.",
    },
    {
      q: "TikTok audio quality kaisi hoti hai?",
      a: "Hum TikTok ka original audio track extract karte hain — koi quality loss nahi. Jo quality TikTok pe hai wahi tumhe milegi.",
    },
    {
      q: "Kya yeh bilkul free hai?",
      a: "Haan, 100% free hai. Koi account nahi, koi limit nahi, koi paisa nahi.",
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
          className="text-4xl md:text-6xl font-extrabold text-white mb-4 leading-tight"
        >
          TikTok MP3{" "}
          <span className="text-gradient">Downloader</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="text-lg text-white/60 mb-10 max-w-xl"
        >
          TikTok videos se directly MP3 audio extract karo — watermark-free, free, instant.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="w-full max-w-2xl"
        >
          <MiniInput onSubmit={fetchInfo} isPending={getVideoInfo.isPending} />
        </motion.div>
      </section>

      <div id="result-section">
        <ResultSection
          info={videoData}
          error={errorMsg}
          errorCode={errorCode}
          isLoading={getVideoInfo.isPending}
          mediaType="audio"
          onReset={() => { setVideoData(null); setErrorMsg(null); setErrorCode(null); setLastUrl(""); }}
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
