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
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [lastUrl, setLastUrl] = useState<string>("");
  const [mediaType, setMediaType] = useState<"video" | "audio">("video");

  const fetchInfo = (url: string, type: "video" | "audio") => {
    setVideoData(null);
    setErrorMsg(null);
    setErrorCode(null);
    setLastUrl(url);
    setMediaType(type);

    getVideoInfo.mutate(
      { data: { url } },
      {
        onSuccess: (data) => {
          setVideoData(data);
          setTimeout(() => {
            document.getElementById("result-section")?.scrollIntoView({ behavior: "smooth" });
          }, 100);
        },
        onError: (err: any) => {
          setErrorCode(err?.response?.data?.errorCode || null);
          setErrorMsg(
            err?.response?.data?.error ||
              "Failed to fetch video information. Please check the URL and try again.",
          );
          setTimeout(() => {
            document.getElementById("result-section")?.scrollIntoView({ behavior: "smooth" });
          }, 100);
        },
      },
    );
  };

  const handleReset = () => {
    setVideoData(null);
    setErrorMsg(null);
    setErrorCode(null);
    setLastUrl("");
  };

  return (
    <div className="flex flex-col w-full">
      <HeroSection onSubmit={fetchInfo} isPending={getVideoInfo.isPending} />

      <div id="result-section">
        <ResultSection
          info={videoData}
          error={errorMsg}
          errorCode={errorCode}
          isLoading={getVideoInfo.isPending}
          mediaType={mediaType}
          onReset={handleReset}
          onRetry={lastUrl ? () => fetchInfo(lastUrl, mediaType) : undefined}
        />
      </div>

      <HowItWorksSection />
      <FeaturesSection />
      <PlatformsSection />
    </div>
  );
}
