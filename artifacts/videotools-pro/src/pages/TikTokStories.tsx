import { useState } from "react";
import { useGetVideoInfo } from "@workspace/api-client-react";
import { VideoInfo } from "@workspace/api-client-react/src/generated/api.schemas";
import { ResultSection } from "@/components/downloader/ResultSection";
import { Play, CheckCircle2 } from "lucide-react";
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
          className="w-full bg-black/50 border-2 border-white/10 focus:border-pink-500/60 rounded-2xl px-4 py-4 text-white placeholder:text-white/40 focus:outline-none transition-all text-base"
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
          className="shrink-0 px-6 py-4 rounded-2xl bg-gradient-to-r from-pink-600 to-purple-600 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold transition-all"
        >
          {isPending ? "..." : "Download"}
        </button>
      </div>
    </div>
  );
}

export default function TikTokStories() {
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
      { data: { url, mediaType: "video" } },
      {
        onSuccess: (data) => setVideoData(data),
        onError: (err: any) => {
          setErrorCode(err?.response?.data?.errorCode || null);
          setErrorMsg(err?.response?.data?.error || "Failed to fetch. Check the URL and try again.");
        },
      }
    );
  };

  const features = [
    { title: "Watermark Free", desc: "Bina TikTok watermark ke saaf video download karo" },
    { title: "HD Quality", desc: "Original HD quality mein — koi compression nahi" },
    { title: "All TikTok Links", desc: "vt.tiktok.com, vm.tiktok.com, share links — sab kaam karte hain" },
    { title: "100% Free", desc: "Koi account, koi limit, koi paisa nahi" },
  ];

  const faqs = [
    {
      q: "TikTok video kaise download karte hain?",
      a: "TikTok pe video open karo. Share button → Copy Link tap karo. Woh link upar paste karo aur Download click karo.",
    },
    {
      q: "Kya share links bhi kaam karte hain?",
      a: "Haan! vt.tiktok.com, vm.tiktok.com — sab short links handle hote hain. Seedha share karke paste karo.",
    },
    {
      q: "Watermark hoga ya nahi?",
      a: "Bilkul nahi. Hum TikTok ka original watermark-free version dete hain — wahi jo TikTok app ke andar hota hai.",
    },
    {
      q: "Private videos download ho sakte hain?",
      a: "Nahi — sirf public videos download ho sakti hain. Private ya friends-only videos supported nahi hain.",
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
          <Play className="w-4 h-4 text-pink-400" />
          <span className="text-xs font-bold tracking-wider text-white/90">
            TIKTOK VIDEO • HD • NO WATERMARK
          </span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="text-4xl md:text-6xl font-extrabold text-white mb-4 leading-tight"
        >
          TikTok Video{" "}
          <span className="bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">
            Downloader
          </span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="text-lg text-white/60 mb-10 max-w-xl"
        >
          TikTok videos HD mein download karo — bina watermark, bina account, bilkul free.
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
          mediaType="video"
          onReset={() => { setVideoData(null); setErrorMsg(null); setErrorCode(null); setLastUrl(""); }}
          onRetry={lastUrl ? () => fetchInfo(lastUrl) : undefined}
        />
      </div>

      <section className="py-16 px-4 border-t border-white/10">
        <div className="container mx-auto max-w-4xl">
          <h2 className="text-2xl md:text-3xl font-bold text-white text-center mb-10">
            Kyun Choose Karo Humara TikTok Downloader?
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
            {features.map((f, i) => (
              <div key={i} className="glass rounded-2xl p-6 text-center">
                <div className="w-10 h-10 rounded-full bg-pink-500/20 flex items-center justify-center mx-auto mb-4">
                  <span className="text-pink-400 font-bold text-lg">✓</span>
                </div>
                <h3 className="text-white font-bold mb-2">{f.title}</h3>
                <p className="text-white/60 text-sm leading-relaxed">{f.desc}</p>
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
                  <CheckCircle2 className="w-5 h-5 text-pink-400 shrink-0 mt-0.5" />
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
