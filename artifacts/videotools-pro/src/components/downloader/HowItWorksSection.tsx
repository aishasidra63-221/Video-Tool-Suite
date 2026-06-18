import { Link2, ClipboardPaste, Settings2, Download } from "lucide-react";

export function HowItWorksSection() {
  const steps = [
    { icon: Link2, title: "Copy Link", desc: "Find the video you want and copy its URL." },
    { icon: ClipboardPaste, title: "Paste URL", desc: "Paste the link into the input box above." },
    { icon: Settings2, title: "Choose Quality", desc: "Select your preferred video or audio format." },
    { icon: Download, title: "Download", desc: "Click the download button and you're done!" },
  ];

  return (
    <section className="py-24 bg-white/[0.02]">
      <div className="container mx-auto px-4">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-5xl font-bold mb-4">How It Works</h2>
          <p className="text-lg text-muted-foreground">Four simple steps to get your favorite content.</p>
        </div>
        
        <div className="flex flex-col md:flex-row items-center justify-center gap-8 md:gap-4 relative max-w-6xl mx-auto">
          {/* Connecting line for desktop */}
          <div className="hidden md:block absolute top-12 left-1/2 -translate-x-1/2 w-[70%] h-0.5 bg-gradient-to-r from-primary/10 via-primary/50 to-secondary/10" />
          
          {steps.map((step, i) => (
            <div key={i} className="flex-1 flex flex-col items-center text-center relative z-10 w-full max-w-[280px]">
              <div className="w-24 h-24 rounded-full bg-[#0a0a0f] border-4 border-white/5 flex items-center justify-center mb-6 shadow-[0_0_30px_rgba(108,99,255,0.15)] relative">
                <div className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-gradient-primary flex items-center justify-center text-sm font-bold text-white shadow-lg">
                  {i + 1}
                </div>
                <step.icon className="w-10 h-10 text-white/80" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">{step.title}</h3>
              <p className="text-muted-foreground">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
