import { Zap, Droplets, Shield, Smartphone } from "lucide-react";

export function FeaturesSection() {
  const features = [
    { icon: Zap, title: "Lightning Fast", desc: "Download videos in seconds with our optimized servers and dedicated CDN." },
    { icon: Droplets, title: "No Watermark", desc: "Get original quality videos without any annoying logos or watermarks." },
    { icon: Shield, title: "100% Safe & Secure", desc: "No malware, no popup ads, and we don't store your downloads." },
    { icon: Smartphone, title: "Mobile Friendly", desc: "Works perfectly on iOS and Android devices without any apps." },
  ];

  return (
    <section className="py-24 border-t border-white/10 bg-background relative overflow-hidden">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-4xl h-96 bg-primary/10 blur-[120px] pointer-events-none" />
      
      <div className="container mx-auto px-4 relative z-10">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-5xl font-bold mb-4">Why Choose <span className="text-gradient">VideoTools Pro</span>?</h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">Everything you need in a modern video downloader, built with precision and care.</p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((f, i) => (
            <div key={i} className="glass p-8 rounded-3xl hover:-translate-y-2 transition-transform duration-300 group">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-6 group-hover:bg-primary/20 transition-colors">
                <f.icon className="w-7 h-7 text-primary" />
              </div>
              <h3 className="text-xl font-bold text-white mb-3">{f.title}</h3>
              <p className="text-muted-foreground leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
