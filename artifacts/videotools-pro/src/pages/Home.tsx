import { HeroSection } from "@/components/downloader/HeroSection";
import { ResultSection } from "@/components/downloader/ResultSection";
import { FeaturesSection } from "@/components/downloader/FeaturesSection";
import { HowItWorksSection } from "@/components/downloader/HowItWorksSection";
import { PlatformsSection } from "@/components/downloader/PlatformsSection";
import { useGetVideoInfo } from "@workspace/api-client-react";
import { useState } from "react";
import { VideoInfo } from "@workspace/api-client-react/src/generated/api.schemas";
import { motion } from "framer-motion";
import { Zap, ShieldCheck, Download } from "lucide-react";
import { Link } from "wouter";

function TopBanner() {
  return (
    <div className="w-full bg-gradient-to-r from-primary/30 via-purple-600/30 to-pink-600/20 border-b border-white/10 backdrop-blur-sm">
      <div className="container mx-auto px-4 py-2.5 flex items-center justify-center gap-3 flex-wrap">
        <span className="text-xs md:text-sm font-semibold text-white/90 tracking-wide">
          🎉 100% Free &nbsp;·&nbsp; No Watermarks &nbsp;·&nbsp; Up to 4K Quality &nbsp;·&nbsp; No Login Required
        </span>
        <Link
          href="/faq"
          className="text-xs bg-white/15 hover:bg-white/25 text-white px-3 py-0.5 rounded-full transition-colors font-medium"
        >
          FAQ →
        </Link>
      </div>
    </div>
  );
}

function FeatureLines() {
  const lines = [
    {
      icon: Zap,
      text: "Lightning-fast downloads — get your video in seconds, not minutes.",
      color: "text-yellow-400",
      bg: "bg-yellow-400/10",
    },
    {
      icon: ShieldCheck,
      text: "100% safe & private — we never store your videos or track your activity.",
      color: "text-green-400",
      bg: "bg-green-400/10",
    },
    {
      icon: Download,
      text: "Multiple formats & qualities — MP4, MKV, MP3 audio up to 320kbps and 4K video.",
      color: "text-blue-400",
      bg: "bg-blue-400/10",
    },
  ];

  return (
    <section className="py-10 px-4">
      <div className="container mx-auto max-w-3xl">
        <div className="glass rounded-2xl divide-y divide-white/10 overflow-hidden">
          {lines.map((line, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 * i, duration: 0.4 }}
              className="flex items-center gap-4 px-6 py-4"
            >
              <div className={`w-9 h-9 rounded-xl ${line.bg} flex items-center justify-center shrink-0`}>
                <line.icon className={`w-5 h-5 ${line.color}`} />
              </div>
              <p className="text-sm md:text-base text-white/85 leading-snug">{line.text}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  const getVideoInfo = useGetVideoInfo();
  const [videoData, setVideoData] = useState<VideoInfo | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = (url: string) => {
    setVideoData(null);
    setErrorMsg(null);

    getVideoInfo.mutate(
      { data: { url } },
      {
        onSuccess: (data) => {
          setVideoData(data);
        },
        onError: (err: any) => {
          setErrorMsg(
            err?.response?.data?.error ||
              "Failed to fetch video information. Please check the URL and try again.",
          );
        },
      },
    );
  };

  const handleReset = () => {
    setVideoData(null);
    setErrorMsg(null);
  };

  return (
    <div className="flex flex-col w-full">
      <TopBanner />
      <HeroSection onSubmit={handleSubmit} isPending={getVideoInfo.isPending} />

      <div id="result-section">
        <ResultSection
          info={videoData}
          error={errorMsg}
          isLoading={getVideoInfo.isPending}
          onReset={handleReset}
        />
      </div>

      <FeatureLines />
      <HowItWorksSection />
      <FeaturesSection />
      <PlatformsSection />
    </div>
  );
}
