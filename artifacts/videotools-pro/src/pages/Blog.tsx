import { Link } from "wouter";
import { BLOGS, BlogPost } from "@/data/blogs";
import { Calendar, Clock, ArrowRight } from "lucide-react";

/* ─── Category colors ─────────────────────────────────── */
const CATEGORY_COLORS: Record<string, { bg: string; badge: string; accent: string }> = {
  YouTube:  { bg: "from-red-500/20 to-rose-900/10",    badge: "bg-red-500/15 text-red-400",     accent: "#ef4444" },
  TikTok:   { bg: "from-pink-500/20 to-purple-900/10", badge: "bg-pink-500/15 text-pink-400",   accent: "#ec4899" },
  Snapchat: { bg: "from-yellow-400/20 to-amber-900/10",badge: "bg-yellow-400/15 text-yellow-400",accent: "#facc15" },
  Reviews:  { bg: "from-violet-500/20 to-blue-900/10", badge: "bg-violet-500/15 text-violet-400",accent: "#8b5cf6" },
};
const DEFAULT_COLOR = { bg: "from-primary/20 to-blue-900/10", badge: "bg-primary/15 text-primary", accent: "#6c63ff" };

/* ─── SVG cover per blog slug ─────────────────────────── */
function BlogCoverSVG({ slug, accent }: { slug: string; accent: string }) {
  // YouTube video download
  if (slug === "how-to-download-youtube-videos-free") return (
    <svg viewBox="0 0 320 160" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
      <rect width="320" height="160" fill="url(#yt-bg)" rx="12"/>
      <defs>
        <radialGradient id="yt-bg" cx="50%" cy="50%" r="70%">
          <stop offset="0%" stopColor="#ff000022"/>
          <stop offset="100%" stopColor="#00000000"/>
        </radialGradient>
      </defs>
      {/* Film strip */}
      <rect x="30" y="40" width="260" height="80" rx="8" fill="#ffffff08" stroke="#ffffff15" strokeWidth="1"/>
      <rect x="30" y="40" width="16" height="80" fill="#ffffff10"/>
      <rect x="274" y="40" width="16" height="80" fill="#ffffff10"/>
      {[50,65,80,95,110].map(y => <rect key={y} x="33" y={y} width="10" height="8" rx="2" fill="#ffffff20"/>)}
      {[50,65,80,95,110].map(y => <rect key={y} x="277" y={y} width="10" height="8" rx="2" fill="#ffffff20"/>)}
      {/* YouTube play button */}
      <rect x="118" y="52" width="84" height="56" rx="14" fill="#ff0000cc"/>
      <polygon points="148,68 148,92 172,80" fill="white"/>
      {/* Download arrow */}
      <g transform="translate(236,110)">
        <circle cx="0" cy="0" r="14" fill="#ffffff15" stroke="#ffffff30" strokeWidth="1"/>
        <line x1="0" y1="-6" x2="0" y2="5" stroke="white" strokeWidth="2" strokeLinecap="round"/>
        <polyline points="-5,1 0,6 5,1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </g>
    </svg>
  );

  // TikTok no watermark
  if (slug === "download-tiktok-videos-without-watermark") return (
    <svg viewBox="0 0 320 160" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
      <defs>
        <radialGradient id="tk-bg" cx="50%" cy="50%" r="70%">
          <stop offset="0%" stopColor="#ec489922"/>
          <stop offset="100%" stopColor="#00000000"/>
        </radialGradient>
      </defs>
      <rect width="320" height="160" fill="url(#tk-bg)" rx="12"/>
      {/* Phone */}
      <rect x="110" y="20" width="60" height="110" rx="10" fill="#ffffff08" stroke="#ffffff20" strokeWidth="1.5"/>
      <rect x="116" y="30" width="48" height="70" rx="4" fill="#000000aa"/>
      {/* TikTok music note */}
      <text x="132" y="70" fontSize="24" fill="white" fontWeight="bold">♪</text>
      {/* Watermark cross */}
      <circle cx="210" cy="55" r="28" fill="#ff000020" stroke="#ff4444" strokeWidth="1.5"/>
      <text x="198" y="62" fontSize="13" fill="#ff6666" fontWeight="bold">WM</text>
      <line x1="187" y1="32" x2="233" y2="78" stroke="#ff4444" strokeWidth="2.5" strokeLinecap="round"/>
      {/* Sparkles */}
      {[[60,40],[70,100],[250,110],[260,40]].map(([x,y],i)=>(
        <g key={i} transform={`translate(${x},${y})`}>
          <line x1="0" y1="-6" x2="0" y2="6" stroke="#ec4899" strokeWidth="1.5" opacity="0.6"/>
          <line x1="-6" y1="0" x2="6" y2="0" stroke="#ec4899" strokeWidth="1.5" opacity="0.6"/>
        </g>
      ))}
    </svg>
  );

  // Snapchat spotlight
  if (slug === "download-snapchat-spotlight-videos") return (
    <svg viewBox="0 0 320 160" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
      <defs>
        <radialGradient id="snap-bg" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#facc1530"/>
          <stop offset="100%" stopColor="#00000000"/>
        </radialGradient>
      </defs>
      <rect width="320" height="160" fill="url(#snap-bg)" rx="12"/>
      {/* Spotlight rays */}
      {[-40,-20,0,20,40].map((angle, i) => (
        <line key={i}
          x1="160" y1="10"
          x2={160 + Math.sin(angle*Math.PI/180)*160}
          y2={10 + Math.cos(angle*Math.PI/180)*160}
          stroke="#facc15" strokeWidth={i===2?3:1.5} opacity={i===2?0.5:0.2}
          strokeLinecap="round"/>
      ))}
      {/* Ghost */}
      <g transform="translate(120,30)">
        <path d="M40 10 Q40 0 30 0 Q20 0 20 10 L20 70 L27 60 L33 70 L40 60 L47 70 L53 60 L60 70 L60 10 Q60 0 50 0 Q40 0 40 10Z"
          fill="#facc15" opacity="0.9"/>
        <circle cx="33" cy="28" r="7" fill="#1a1a1a"/>
        <circle cx="47" cy="28" r="7" fill="#1a1a1a"/>
        <circle cx="35" cy="26" r="3" fill="white"/>
        <circle cx="49" cy="26" r="3" fill="white"/>
      </g>
      {/* Stars */}
      {[[55,30],[250,50],[265,110],[50,115]].map(([x,y],i)=>(
        <text key={i} x={x} y={y} fontSize="16" fill="#facc15" opacity="0.5">★</text>
      ))}
    </svg>
  );

  // YouTube MP3
  if (slug === "youtube-to-mp3-free-audio-extractor") return (
    <svg viewBox="0 0 320 160" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
      <defs>
        <radialGradient id="mp3-bg" cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor="#ef444430"/>
          <stop offset="100%" stopColor="#00000000"/>
        </radialGradient>
      </defs>
      <rect width="320" height="160" fill="url(#mp3-bg)" rx="12"/>
      {/* Headphones */}
      <path d="M160 30 Q115 30 115 75 L115 95 Q115 105 125 105 L135 105 Q145 105 145 95 L145 80 Q145 70 135 70 L125 70 Q120 70 118 72 Q120 45 160 45 Q200 45 202 72 Q200 70 195 70 L185 70 Q175 70 175 80 L175 95 Q175 105 185 105 L195 105 Q205 105 205 95 L205 75 Q205 30 160 30Z"
        fill="none" stroke="#ef4444" strokeWidth="3" strokeLinecap="round"/>
      {/* Sound waves */}
      {[1,2,3].map(i => (
        <g key={i}>
          <path d={`M ${55 - i*14} ${75 - i*8} Q ${48 - i*14} 80 ${55 - i*14} ${85 + i*8}`}
            stroke="#ef4444" strokeWidth="2" fill="none" opacity={1-i*0.25} strokeLinecap="round"/>
          <path d={`M ${265 + i*14} ${75 - i*8} Q ${272 + i*14} 80 ${265 + i*14} ${85 + i*8}`}
            stroke="#ef4444" strokeWidth="2" fill="none" opacity={1-i*0.25} strokeLinecap="round"/>
        </g>
      ))}
      {/* MP3 badge */}
      <rect x="126" y="120" width="68" height="28" rx="8" fill="#ef444430" stroke="#ef4444" strokeWidth="1"/>
      <text x="160" y="139" fontSize="13" fill="#ef4444" fontWeight="bold" textAnchor="middle">MP3</text>
    </svg>
  );

  // Best free downloader (Reviews)
  if (slug === "best-free-online-video-downloader-2026") return (
    <svg viewBox="0 0 320 160" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
      <defs>
        <radialGradient id="rev-bg" cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor="#8b5cf630"/>
          <stop offset="100%" stopColor="#00000000"/>
        </radialGradient>
      </defs>
      <rect width="320" height="160" fill="url(#rev-bg)" rx="12"/>
      {/* Trophy */}
      <path d="M140 30 L180 30 L180 75 Q180 100 160 105 Q140 100 140 75Z" fill="#8b5cf620" stroke="#8b5cf6" strokeWidth="2"/>
      <rect x="150" y="105" width="20" height="15" fill="#8b5cf640" stroke="#8b5cf6" strokeWidth="1.5"/>
      <rect x="140" y="120" width="40" height="8" rx="4" fill="#8b5cf640" stroke="#8b5cf6" strokeWidth="1.5"/>
      {/* Handles */}
      <path d="M140 45 Q120 45 120 60 Q120 75 140 75" fill="none" stroke="#8b5cf6" strokeWidth="2"/>
      <path d="M180 45 Q200 45 200 60 Q200 75 180 75" fill="none" stroke="#8b5cf6" strokeWidth="2"/>
      {/* Star */}
      <text x="152" y="78" fontSize="22" fill="#8b5cf6" fontWeight="bold">★</text>
      {/* Stars around */}
      {[[65,40],[255,35],[60,110],[258,115],[80,70],[240,75]].map(([x,y],i)=>(
        <text key={i} x={x} y={y} fontSize={i<2?18:12} fill="#8b5cf6" opacity={i<2?0.7:0.35}>★</text>
      ))}
    </svg>
  );

  // YouTube Shorts
  if (slug === "how-to-download-youtube-shorts") return (
    <svg viewBox="0 0 320 160" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
      <defs>
        <radialGradient id="shorts-bg" cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor="#ef444425"/>
          <stop offset="100%" stopColor="#00000000"/>
        </radialGradient>
      </defs>
      <rect width="320" height="160" fill="url(#shorts-bg)" rx="12"/>
      {/* Phone vertical */}
      <rect x="128" y="15" width="64" height="118" rx="10" fill="#ffffff08" stroke="#ffffff25" strokeWidth="1.5"/>
      <rect x="134" y="24" width="52" height="90" rx="4" fill="#000000aa"/>
      {/* Shorts play */}
      <rect x="134" y="24" width="52" height="90" rx="4" fill="#ef444415"/>
      <circle cx="160" cy="69" r="18" fill="#ef444450"/>
      <polygon points="154,61 154,77 170,69" fill="white"/>
      {/* "Shorts" label */}
      <rect x="137" y="100" width="46" height="10" rx="5" fill="#ef444430"/>
      <text x="160" y="108" fontSize="7" fill="#ef4444" textAnchor="middle" fontWeight="bold">SHORTS</text>
      {/* Scroll indicators */}
      <g transform="translate(220,60)">
        <circle cx="0" cy="0" r="18" fill="#ffffff08" stroke="#ffffff15" strokeWidth="1"/>
        <polyline points="-6,-3 0,-9 6,-3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <polyline points="-6,3 0,9 6,3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </g>
    </svg>
  );

  // TikTok HD
  if (slug === "tiktok-hd-download-maximum-quality") return (
    <svg viewBox="0 0 320 160" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
      <defs>
        <radialGradient id="hd-bg" cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor="#ec489925"/>
          <stop offset="100%" stopColor="#00000000"/>
        </radialGradient>
      </defs>
      <rect width="320" height="160" fill="url(#hd-bg)" rx="12"/>
      {/* HD badge */}
      <rect x="90" y="40" width="140" height="70" rx="12" fill="#ffffff08" stroke="#ec4899" strokeWidth="2"/>
      <text x="160" y="92" fontSize="44" fill="#ec4899" fontWeight="900" textAnchor="middle" letterSpacing="-2">HD</text>
      {/* Quality bars */}
      {[6,9,12,15,18].map((h,i) => (
        <rect key={i} x={52+i*12} y={115-h} width="8" height={h} rx="2"
          fill="#ec4899" opacity={0.3 + i*0.15}/>
      ))}
      {[6,9,12,15,18].map((h,i) => (
        <rect key={i} x={204+i*12} y={115-h} width="8" height={h} rx="2"
          fill="#ec4899" opacity={0.3 + i*0.15}/>
      ))}
      {/* TikTok music note */}
      <text x="54" y="58" fontSize="20" fill="#ec4899" opacity="0.5">♪</text>
      <text x="240" y="58" fontSize="20" fill="#ec4899" opacity="0.5">♪</text>
    </svg>
  );

  // Default
  return (
    <svg viewBox="0 0 320 160" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
      <rect width="320" height="160" fill={`${accent}15`} rx="12"/>
      <circle cx="160" cy="80" r="40" fill={`${accent}25`} stroke={`${accent}50`} strokeWidth="2"/>
      <line x1="160" y1="60" x2="160" y2="80" stroke={accent} strokeWidth="3" strokeLinecap="round"/>
      <circle cx="160" cy="90" r="3" fill={accent}/>
    </svg>
  );
}

/* ─── Blog Card ───────────────────────────────────────── */
function BlogCard({ post }: { post: BlogPost }) {
  const colors = CATEGORY_COLORS[post.category] ?? DEFAULT_COLOR;

  return (
    <Link
      href={`/blog/${post.slug}`}
      className="group flex flex-col rounded-2xl overflow-hidden border border-white/10 hover:border-primary/40 glass transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_8px_30px_rgba(108,99,255,0.15)]"
    >
      {/* Cover image */}
      <div className={`relative w-full aspect-[2/1] bg-gradient-to-br ${colors.bg} overflow-hidden`}>
        <BlogCoverSVG slug={post.slug} accent={colors.accent ?? "#6c63ff"} />
        {/* Category badge overlay */}
        <span className={`absolute top-3 left-3 text-[10px] font-bold tracking-widest uppercase px-2.5 py-1 rounded-full backdrop-blur-sm ${colors.badge}`}>
          {post.category}
        </span>
      </div>

      {/* Content */}
      <div className="flex flex-col flex-1 p-5 gap-3">
        <h2 className="text-base font-bold leading-snug group-hover:text-primary transition-colors line-clamp-2">
          {post.title}
        </h2>

        <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2 flex-1">
          {post.excerpt}
        </p>

        <div className="flex items-center justify-between text-xs text-muted-foreground pt-3 border-t border-white/10 mt-auto">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {post.date}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {post.readTime}
            </span>
          </div>
          <span className="flex items-center gap-1 text-primary font-semibold group-hover:gap-2 transition-all">
            Read <ArrowRight className="w-3 h-3" />
          </span>
        </div>
      </div>
    </Link>
  );
}

/* ─── Blog Page ───────────────────────────────────────── */
export default function Blog() {
  return (
    <div className="min-h-screen py-16">
      <div className="container mx-auto px-4 max-w-6xl">

        {/* Header */}
        <div className="text-center mb-14">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full glass mb-6 border border-white/10">
            <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4 text-primary" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="14" height="12" rx="2"/>
              <line x1="7" y1="8" x2="13" y2="8"/>
              <line x1="7" y1="11" x2="11" y2="11"/>
            </svg>
            <span className="text-xs font-bold tracking-widest uppercase text-white/80">
              Blog & Guides
            </span>
          </div>
          <h1 className="text-4xl md:text-6xl font-extrabold mb-5 leading-tight">
            Video Download <span className="text-gradient">Guides</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Step-by-step guides on how to download YouTube, TikTok, and Snapchat videos for free — tips, tricks, and everything you need to know.
          </p>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {BLOGS.map((post) => (
            <BlogCard key={post.slug} post={post} />
          ))}
        </div>

      </div>
    </div>
  );
}
