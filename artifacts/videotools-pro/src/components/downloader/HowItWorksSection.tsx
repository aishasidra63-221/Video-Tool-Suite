import { Link2, ClipboardPaste, Settings2, Download } from "lucide-react";

export function HowItWorksSection() {
  const steps = [
    { icon: Link2,         title: "Copy Link",     desc: "Find the video you want and copy its URL." },
    { icon: ClipboardPaste, title: "Paste URL",    desc: "Paste the link into the input box above." },
    { icon: Settings2,     title: "Choose Quality", desc: "Select your preferred video or audio format." },
    { icon: Download,      title: "Download",      desc: "Click the download button and you're done!" },
  ];

  return (
    <section className="py-24 bg-white/[0.02]">
      <div className="container mx-auto px-4">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-5xl font-bold mb-4">How It Works</h2>
          <p className="text-lg text-muted-foreground">Four simple steps to get your favorite content.</p>
        </div>

        {/* ── Desktop: horizontal row ── */}
        <div className="hidden md:flex items-start justify-center gap-4 relative max-w-5xl mx-auto">
          {/* Horizontal connector */}
          <div className="absolute top-12 left-1/2 -translate-x-1/2 w-[72%] h-0.5 bg-gradient-to-r from-primary/10 via-primary/50 to-secondary/10" />

          {steps.map((step, i) => (
            <div key={i} className="flex-1 flex flex-col items-center text-center relative z-10 max-w-[240px]">
              <div className="w-24 h-24 rounded-full bg-[#0a0a0f] border-4 border-white/5 flex items-center justify-center mb-6 shadow-[0_0_30px_rgba(108,99,255,0.15)] relative">
                <div className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-gradient-primary flex items-center justify-center text-sm font-bold text-white shadow-lg">
                  {i + 1}
                </div>
                <step.icon className="w-10 h-10 text-white/80" />
              </div>
              <h3 className="text-xl font-bold mb-2">{step.title}</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">{step.desc}</p>
            </div>
          ))}
        </div>

        {/* ── Mobile: vertical timeline ── */}
        <div className="md:hidden relative max-w-xs mx-auto">
          {/* Vertical line — spans full height of the list */}
          <div className="absolute left-[2.4rem] top-12 bottom-12 w-0.5 bg-gradient-to-b from-primary/80 via-secondary/60 to-primary/10" />

          <div className="flex flex-col gap-0">
            {steps.map((step, i) => (
              <div key={i} className="flex items-start gap-5 py-5 relative">
                {/* Circle icon — sits on top of the vertical line */}
                <div className="shrink-0 w-20 h-20 rounded-full bg-[#0a0a0f] border-4 border-white/5 flex items-center justify-center shadow-[0_0_24px_rgba(108,99,255,0.18)] relative z-10">
                  <div className="absolute -top-2.5 -right-2.5 w-7 h-7 rounded-full bg-gradient-primary flex items-center justify-center text-xs font-bold text-white shadow-lg">
                    {i + 1}
                  </div>
                  <step.icon className="w-9 h-9 text-white/80" />
                </div>

                {/* Text */}
                <div className="pt-4">
                  <h3 className="text-lg font-bold mb-1">{step.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </section>
  );
}
