import { HeroSection } from "@/components/downloader/HeroSection";
import { ResultSection } from "@/components/downloader/ResultSection";
import { FeaturesSection } from "@/components/downloader/FeaturesSection";
import { HowItWorksSection } from "@/components/downloader/HowItWorksSection";
import { PlatformsSection } from "@/components/downloader/PlatformsSection";
import { useGetVideoInfo } from "@workspace/api-client-react";
import { useState } from "react";
import { VideoInfo } from "@workspace/api-client-react/src/generated/api.schemas";

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
