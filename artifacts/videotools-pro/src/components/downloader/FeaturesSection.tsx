export function FeaturesSection() {
  const features = [
    {
      number: "01",
      title: "Lightning Fast",
      desc: "Optimized servers process your download in seconds — no waiting, no queues.",
      stat: "< 5 sec",
      statLabel: "avg. process time",
      color: "from-amber-500 to-orange-500",
      glow: "rgba(245,158,11,0.15)",
      border: "border-amber-500/20 hover:border-amber-400/50",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
      ),
    },
    {
      number: "02",
      title: "No Watermark",
      desc: "Original quality downloads — no logos, no overlays, no branding added.",
      stat: "100%",
      statLabel: "original quality",
      color: "from-violet-500 to-purple-600",
      glow: "rgba(139,92,246,0.15)",
      border: "border-violet-500/20 hover:border-violet-400/50",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M8 12l3 3 5-5" />
        </svg>
      ),
    },
    {
      number: "03",
      title: "Safe & Secure",
      desc: "Zero malware, zero popups. We never store your videos or personal data.",
      stat: "0",
      statLabel: "data stored",
      color: "from-emerald-500 to-teal-500",
      glow: "rgba(16,185,129,0.15)",
      border: "border-emerald-500/20 hover:border-emerald-400/50",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3l7 3v5c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6l7-3z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      ),
    },
    {
      number: "04",
      title: "All Devices",
      desc: "Works flawlessly on desktop, iPhone, and Android — no app install needed.",
      stat: "6+",
      statLabel: "platforms supported",
      color: "from-sky-500 to-blue-600",
      glow: "rgba(14,165,233,0.15)",
      border: "border-sky-500/20 hover:border-sky-400/50",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="2" width="14" height="20" rx="2" />
          <path d="M12 18h.01" />
        </svg>
      ),
    },
  ];

  return (
    <section className="py-28 border-t border-white/10 bg-background relative overflow-hidden">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-5xl h-96 bg-primary/8 blur-[140px] pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-80 h-80 bg-secondary/8 blur-[100px] pointer-events-none" />

      <div className="container mx-auto px-4 relative z-10">
        <div className="text-center mb-20">
          <span className="inline-block text-xs font-bold tracking-[0.2em] uppercase text-primary/80 mb-4 px-4 py-1.5 rounded-full border border-primary/20 bg-primary/5">
            Why Us
          </span>
          <h2 className="text-3xl md:text-5xl font-extrabold mb-5 tracking-tight">
            Why Choose{" "}
            <span className="text-gradient">VideoTools Pro</span>?
          </h2>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
            Built for speed, privacy, and quality — everything a modern downloader should be.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {features.map((f, i) => (
            <div
              key={i}
              className={`group relative rounded-3xl border bg-white/[0.03] backdrop-blur-sm p-7 transition-all duration-300 hover:-translate-y-1.5 hover:bg-white/[0.06] ${f.border}`}
              style={{ boxShadow: `0 0 0 0 ${f.glow}`, transition: "box-shadow 0.3s, transform 0.3s, background 0.3s, border-color 0.3s" }}
              onMouseEnter={e => (e.currentTarget.style.boxShadow = `0 8px 40px ${f.glow}`)}
              onMouseLeave={e => (e.currentTarget.style.boxShadow = `0 0 0 0 ${f.glow}`)}
            >
              <span className="absolute top-5 right-6 text-4xl font-black text-white/[0.04] select-none leading-none">
                {f.number}
              </span>

              <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${f.color} flex items-center justify-center mb-6 text-white shadow-lg`}>
                {f.icon}
              </div>

              <h3 className="text-lg font-bold text-white mb-2.5 tracking-tight">{f.title}</h3>
              <p className="text-sm text-white/50 leading-relaxed mb-6">{f.desc}</p>

              <div className={`pt-5 border-t border-white/8`}>
                <span className={`text-2xl font-extrabold bg-gradient-to-r ${f.color} bg-clip-text text-transparent`}>
                  {f.stat}
                </span>
                <p className="text-[11px] text-white/40 font-medium mt-0.5 uppercase tracking-wide">{f.statLabel}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
