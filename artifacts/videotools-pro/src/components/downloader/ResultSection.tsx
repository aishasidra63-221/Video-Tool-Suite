import { useState } from "react";
import { useGetDownloadUrl } from "@workspace/api-client-react";
import { formatDuration, formatBytes, detectPlatform } from "@/lib/video-utils";
import { PLATFORMS } from "./platform-icons";
import { motion, AnimatePresence } from "framer-motion";
import { Download, Film, Music, Image as ImageIcon, AlertTriangle, RefreshCw } from "lucide-react";
import { VideoInfo } from "@workspace/api-client-react/src/generated/api.schemas";

export function ResultSection({ 
  info, 
  error, 
  isLoading, 
  onReset 
}: { 
  info: VideoInfo | null, 
  error: string | null,
  isLoading: boolean,
  onReset: () => void
}) {
  const [activeTab, setActiveTab] = useState<'video' | 'audio'>('video');
  const getDownloadUrl = useGetDownloadUrl();

  const handleDownload = (url: string, formatId: string) => {
    getDownloadUrl.mutate({ data: { url, formatId } }, {
      onSuccess: (data) => {
        // Trigger programmatic download
        const a = document.createElement('a');
        a.href = data.downloadUrl;
        a.download = data.filename || 'download';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    });
  };

  const handleThumbnailDownload = (url: string) => {
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = 'thumbnail.jpg';
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  if (!isLoading && !info && !error) return null;

  return (
    <section className="w-full max-w-4xl mx-auto px-4 pb-20">
      <AnimatePresence mode="wait">
        {isLoading && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="glass rounded-3xl p-12 flex flex-col items-center justify-center text-center shadow-xl"
          >
            <div className="w-16 h-16 border-4 border-primary/30 border-t-primary rounded-full animate-spin mb-6" />
            <h3 className="text-xl font-bold text-white mb-2">Fetching video info...</h3>
            <p className="text-muted-foreground">This usually takes just a few seconds.</p>
          </motion.div>
        )}

        {error && !isLoading && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass border-red-500/30 bg-red-500/5 rounded-3xl p-8 flex flex-col items-center justify-center text-center shadow-xl"
          >
            <AlertTriangle className="w-16 h-16 text-red-500 mb-4" />
            <h3 className="text-2xl font-bold text-white mb-2">Oops! Something went wrong</h3>
            <p className="text-red-200 mb-8 max-w-md">{error}</p>
            <button 
              onClick={onReset}
              className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white px-6 py-3 rounded-xl font-medium transition-colors"
            >
              <RefreshCw className="w-5 h-5" />
              Try Another URL
            </button>
          </motion.div>
        )}

        {info && !isLoading && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass rounded-3xl overflow-hidden shadow-2xl"
          >
            <div className="grid grid-cols-1 md:grid-cols-5 gap-0">
              {/* Left Column: Thumbnail & Info */}
              <div className="md:col-span-2 p-6 bg-white/5 border-r border-white/5">
                <div className="relative rounded-xl overflow-hidden aspect-video bg-black mb-6 shadow-lg">
                  {info.thumbnail ? (
                    <img src={info.thumbnail} alt={info.title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-white/20">No Thumbnail</div>
                  )}
                  {info.duration && (
                    <div className="absolute bottom-2 right-2 bg-black/80 backdrop-blur text-white text-xs font-mono px-2 py-1 rounded">
                      {formatDuration(info.duration)}
                    </div>
                  )}
                </div>
                
                <h3 className="text-lg font-bold text-white line-clamp-2 mb-3 leading-snug">
                  {info.title}
                </h3>
                
                <div className="flex items-center gap-2 mb-6">
                  {(() => {
                    const platform = PLATFORMS.find(p => p.id === detectPlatform(info.url));
                    if (!platform) return <div className="px-3 py-1 rounded-full bg-white/10 text-xs font-medium">{info.platform}</div>;
                    const Icon = platform.IconComponent;
                    return (
                      <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 text-xs font-bold">
                        <Icon className="w-4 h-4" />
                        <span>{platform.name}</span>
                      </div>
                    );
                  })()}
                </div>

                <button 
                  onClick={() => handleThumbnailDownload(info.thumbnail || '')}
                  disabled={!info.thumbnail}
                  className="w-full flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 text-white px-4 py-3 rounded-xl font-medium transition-colors text-sm disabled:opacity-50"
                >
                  <ImageIcon className="w-4 h-4" />
                  Download Thumbnail
                </button>
              </div>

              {/* Right Column: Download Options */}
              <div className="md:col-span-3 p-6 flex flex-col">
                <div className="flex bg-white/5 rounded-xl p-1 mb-6">
                  <button 
                    onClick={() => setActiveTab('video')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-colors ${activeTab === 'video' ? 'bg-primary text-white shadow-md' : 'text-white/60 hover:text-white'}`}
                  >
                    <Film className="w-4 h-4" /> Video
                  </button>
                  <button 
                    onClick={() => setActiveTab('audio')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-colors ${activeTab === 'audio' ? 'bg-secondary text-white shadow-md' : 'text-white/60 hover:text-white'}`}
                  >
                    <Music className="w-4 h-4" /> Audio
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-3 max-h-[400px]">
                  {info.formats
                    .filter(f => f.type === activeTab)
                    .map((format, i) => (
                    <div key={i} className="flex items-center justify-between p-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 transition-colors">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-bold text-white text-lg">{format.quality}</span>
                          {format.badge && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wider bg-white/10 text-white/80 uppercase">
                              {format.badge}
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground font-mono">
                          {formatBytes(format.filesize) ? `${formatBytes(format.filesize)} • ` : ""}{format.label}
                        </span>
                      </div>
                      
                      <button
                        onClick={() => handleDownload(info.url, format.formatId)}
                        disabled={getDownloadUrl.isPending}
                        className="flex items-center justify-center w-12 h-12 rounded-xl bg-green-500/20 text-green-400 hover:bg-green-500 hover:text-white transition-all shadow-[0_0_10px_rgba(34,197,94,0.2)] hover:shadow-[0_0_20px_rgba(34,197,94,0.4)] disabled:opacity-50"
                      >
                        {getDownloadUrl.isPending && getDownloadUrl.variables?.data.formatId === format.formatId ? (
                          <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                          <Download className="w-5 h-5" />
                        )}
                      </button>
                    </div>
                  ))}
                  
                  {info.formats.filter(f => f.type === activeTab).length === 0 && (
                    <div className="text-center py-12 text-muted-foreground">
                      No {activeTab} formats available for this video.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
