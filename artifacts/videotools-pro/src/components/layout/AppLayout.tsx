import { Link } from "wouter";

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col min-h-screen">
      <Navbar />
      <main className="flex-1">
        {children}
      </main>
      <Footer />
    </div>
  );
}

function Navbar() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/10 bg-background/80 backdrop-blur-md">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-xl font-bold text-gradient">VideoTools Pro</span>
        </Link>
        <nav className="hidden md:flex gap-6">
          <Link href="/" className="text-sm font-medium text-white/80 hover:text-white transition-colors">Home</Link>
          <Link href="/#about" className="text-sm font-medium text-white/80 hover:text-white transition-colors">About</Link>
          <Link href="/privacy" className="text-sm font-medium text-white/80 hover:text-white transition-colors">Privacy</Link>
          <Link href="/terms" className="text-sm font-medium text-white/80 hover:text-white transition-colors">Terms</Link>
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="border-t border-white/10 bg-background py-12">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          <div className="col-span-1 md:col-span-2">
            <Link href="/" className="inline-block mb-4">
              <span className="text-xl font-bold text-gradient">VideoTools Pro</span>
            </Link>
            <p className="text-muted-foreground text-sm max-w-sm">
              Download videos from any platform, free forever. The fastest, most reliable video downloader online.
            </p>
          </div>
          <div>
            <h4 className="font-semibold mb-4 text-white">Legal</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><Link href="/privacy" className="hover:text-white transition-colors">Privacy Policy</Link></li>
              <li><Link href="/terms" className="hover:text-white transition-colors">Terms of Service</Link></li>
              <li><Link href="/disclaimer" className="hover:text-white transition-colors">Disclaimer</Link></li>
              <li><Link href="/dmca" className="hover:text-white transition-colors">DMCA</Link></li>
            </ul>
          </div>
        </div>
        <div className="pt-8 border-t border-white/10 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">© 2026 VideoTools Pro. All rights reserved.</p>
          <p className="text-xs font-medium text-yellow-500/80 bg-yellow-500/10 px-3 py-1 rounded-full text-center">
            ⚠️ No videos are stored on our servers. We respect copyright laws. For personal use only.
          </p>
        </div>
      </div>
    </footer>
  );
}
