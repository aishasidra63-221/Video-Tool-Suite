import { HeroSection } from "@/components/downloader/HeroSection";
import { ResultSection } from "@/components/downloader/ResultSection";
import { FeaturesSection } from "@/components/downloader/FeaturesSection";
import { HowItWorksSection } from "@/components/downloader/HowItWorksSection";
import { PlatformsSection } from "@/components/downloader/PlatformsSection";
import { useGetVideoInfo } from "@workspace/api-client-react";
import { useState } from "react";
import { VideoInfo } from "@workspace/api-client-react/src/generated/api.schemas";
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

      <HowItWorksSection />
      <FeaturesSection />
      <PlatformsSection />
    </div>
  );
}
