import { detectPlatform, isValidUrl } from "@/lib/video-utils";
import { useState } from "react";
import { SiYoutube, SiTiktok, SiInstagram, SiFacebook, SiSnapchat, SiX } from "react-icons/si";
import { Download, X, ClipboardPaste, CheckCircle2, AlertCircle } from "lucide-react";
import { motion } from "framer-motion";

export const PLATFORMS = [
  { id: "youtube", name: "YouTube", icon: SiYoutube, color: "#ff0000", hoverClass: "hover:text-[#ff0000]", bgClass: "bg-[#ff0000]" },
  { id: "tiktok", name: "TikTok", icon: SiTiktok, color: "#ffffff", hoverClass: "hover:text-white", bgClass: "bg-white text-black" },
  { id: "instagram", name: "Instagram", icon: SiInstagram, color: "#E1306C", hoverClass: "hover:text-[#E1306C]", bgClass: "bg-gradient-to-tr from-[#f09433] via-[#e6683c] to-[#bc1888]" },
  { id: "facebook", name: "Facebook", icon: SiFacebook, color: "#1877f2", hoverClass: "hover:text-[#1877f2]", bgClass: "bg-[#1877f2]" },
  { id: "snapchat", name: "Snapchat", icon: SiSnapchat, color: "#fffc00", hoverClass: "hover:text-[#fffc00]", bgClass: "bg-[#fffc00] text-black" },
  { id: "twitter", name: "Twitter/X", icon: SiX, color: "#ffffff", hoverClass: "hover:text-white", bgClass: "bg-white text-black" },
];

export function HeroSection({ onSubmit, isPending }: { onSubmit: (url: string) => void, isPending: boolean }) {
  const [url, setUrl] = useState("");
  
  const platformId = detectPlatform(url);
  const platform = PLATFORMS.find(p => p.id === platformId);
  const isUrlValid = isValidUrl(url);
  const showSuccess = url.length > 0 && isUrlValid && platformId;
  const showError = url.length > 0 && (!isUrlValid || !platformId);

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text);
    } catch (err) {
      console.error("Failed to read clipboard contents: ", err);
    }
  };

  return (
    <section className="w-full pt-20 pb-16 px-4 text-center flex flex-col items-center">
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full glass mb-8 animate-pulse shadow-[0_0_15px_rgba(108,99,255,0.3)]"
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
      
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.3 }}
        className="flex flex-wrap justify-center gap-4 mb-10"
      >
        {PLATFORMS.map((p) => (
          <button key={p.id} onClick={() => setUrl(`https://${p.id}.com/`)} className={`flex items-center gap-2 px-4 py-2 rounded-full glass transition-all duration-300 ${p.hoverClass} hover:scale-105 group`}>
            <p.icon className="w-5 h-5 transition-transform group-hover:scale-110" />
            <span className="text-sm font-semibold">{p.name}</span>
          </button>
        ))}
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
            {platform && (
              <div className="absolute left-4 top-1/2 -translate-y-1/2 flex items-center justify-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${platform.bgClass}`}>
                  <platform.icon className="w-4 h-4" />
                </div>
              </div>
            )}
            
            <input 
              type="text" 
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste video URL here... (YouTube, TikTok, Instagram...)" 
              className={`w-full bg-black/50 border-2 rounded-2xl px-4 py-5 md:py-6 text-white placeholder:text-white/40 focus:outline-none transition-all pr-24 ${platform ? 'pl-14' : 'pl-6'} text-lg shadow-inner ${
                showSuccess ? 'border-green-500/50 focus:border-green-500' : 
                showError ? 'border-red-500/50 focus:border-red-500' : 
                'border-white/10 focus:border-primary/50'
              }`}
            />
            
            <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
              {url && (
                <button onClick={() => setUrl("")} className="text-white/40 hover:text-white transition-colors p-1" title="Clear">
                  <X className="w-5 h-5" />
                </button>
              )}
              {!url && (
                <button onClick={handlePaste} className="text-white/60 hover:text-white transition-colors p-2 rounded-lg bg-white/5 hover:bg-white/10" title="Paste from clipboard">
                  <ClipboardPaste className="w-5 h-5" />
                </button>
              )}
            </div>
          </div>
          
          <button 
            disabled={!url || isPending}
            onClick={() => onSubmit(url)}
            className="w-full md:w-auto bg-gradient-primary hover-shimmer text-white px-8 py-5 md:py-6 rounded-2xl font-bold text-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 shrink-0 shadow-[0_0_20px_rgba(108,99,255,0.4)]"
          >
            {isPending ? (
              <div className="w-6 h-6 border-3 border-white/30 border-t-white rounded-full animate-spin" />
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
            <span className="text-sm">Please enter a valid supported URL</span>
          </motion.div>
        )}
        {showSuccess && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-3 text-left px-2 flex items-center gap-2 text-green-400">
            <CheckCircle2 className="w-4 h-4" />
            <span className="text-sm">{platform?.name} URL detected</span>
          </motion.div>
        )}
      </motion.div>
      
      <motion.p 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="text-sm md:text-base text-muted-foreground font-medium"
      >
        2.4M+ Videos Downloaded • 98% User Satisfaction • ⭐ 4.9/5 Rating • 6 Platforms Supported
      </motion.p>
    </section>
  );
}
