import { PLATFORMS } from "./platform-icons";

export function PlatformsSection() {
  return (
    <section className="py-24 border-t border-white/10 bg-background">
      <div className="container mx-auto px-4">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-5xl font-bold mb-4">Supported Platforms</h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            We support downloading from the world's most popular social media networks.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {PLATFORMS.map((p) => {
            const Icon = p.IconComponent;
            return (
              <div
                key={p.id}
                className="glass p-6 rounded-2xl flex flex-col items-center justify-center text-center hover:bg-white/10 transition-all duration-300 group cursor-pointer hover:scale-105"
              >
                <Icon className="w-12 h-12 mb-4 transition-transform group-hover:scale-110" />
                <h3 className="font-bold text-white mb-1">{p.name}</h3>
                <p className="text-xs text-muted-foreground">{p.supports}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
