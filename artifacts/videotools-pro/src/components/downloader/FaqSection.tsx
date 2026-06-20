import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const FAQS = [
  {
    q: "How to download YouTube videos for free?",
    a: "Copy the YouTube video URL, paste it into VideoTools Pro, select Video and your preferred quality (720p, 1080p, or 1440p), then click Download. No account or registration needed — completely free and instant."
  },
  {
    q: "How to download TikTok without watermark?",
    a: "Open the TikTok video, tap Share → Copy Link. Paste the link into VideoTools Pro and click Download. Our system automatically delivers a clean, watermark-free HD video — no extra steps needed."
  },
  {
    q: "How to download Snapchat Spotlight videos?",
    a: "Open the Snapchat Spotlight video on snapchat.com in your browser, copy the page URL, paste it into VideoTools Pro, and click Download. Works for all public Spotlight videos."
  },
  {
    q: "Can I download YouTube videos as MP3 audio?",
    a: "Yes! Select 'Audio' when downloading any YouTube video. VideoTools Pro extracts high-quality MP3 audio (up to 192kbps). Perfect for podcasts, music, and lectures."
  },
  {
    q: "What video quality options are available?",
    a: "For YouTube: 720p HD, 1080p Full HD, and 1440p 2K — plus Audio MP3. For TikTok: HD (no watermark) and Standard. For Snapchat: HD Original and Compressed 480p."
  },
  {
    q: "Is VideoTools Pro completely free?",
    a: "Yes — 100% free forever. No hidden fees, no premium plans, no download limits, and no login required. Just paste the URL and download."
  },
  {
    q: "Do I need to create an account or sign up?",
    a: "No registration required at all. You can start downloading videos immediately without providing any email address or personal information."
  },
  {
    q: "Does it work on iPhone and Android?",
    a: "Yes, VideoTools Pro is fully mobile-friendly. It works on iPhone, iPad, and all Android devices through any modern browser — Chrome, Safari, Firefox, Edge."
  },
  {
    q: "Is it safe to use this video downloader?",
    a: "Absolutely. Our site uses HTTPS encryption, has no malicious pop-ups or harmful ads, and does not store any of your downloaded videos on our servers. Your privacy is protected."
  },
  {
    q: "Is there a daily download limit?",
    a: "No strict daily limits for normal personal use. Download as many videos as you need. Our servers are optimized to handle requests quickly with no artificial throttling."
  },
  {
    q: "Why is TikTok video download not working?",
    a: "Make sure you are copying the full TikTok URL (from the browser or the app's Share → Copy Link). Short 'vt.tiktok.com' links may not work — use the complete video URL instead."
  },
  {
    q: "How fast is the video download?",
    a: "VideoTools Pro fetches video info in under 2 seconds for most platforms. Download speed depends on your internet connection and the file size — no artificial delays are added."
  },
];

export function FaqSection() {
  return (
    <section className="py-24 bg-white/[0.02]" aria-labelledby="faq-heading">
      <div className="container mx-auto px-4 max-w-4xl">
        <div className="text-center mb-16">
          <h2 id="faq-heading" className="text-3xl md:text-5xl font-bold mb-4">
            Frequently Asked Questions
          </h2>
          <p className="text-lg text-muted-foreground">
            Everything you need to know about downloading YouTube, TikTok, and Snapchat videos free.
          </p>
        </div>

        <div className="glass rounded-3xl p-6 md:p-8">
          <Accordion type="single" collapsible className="w-full">
            {FAQS.map((faq, i) => (
              <AccordionItem key={i} value={`item-${i}`} className="border-white/10">
                <AccordionTrigger className="text-left text-lg font-semibold hover:text-primary transition-colors py-4">
                  {faq.q}
                </AccordionTrigger>
                <AccordionContent className="text-muted-foreground text-base leading-relaxed pb-4">
                  {faq.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </section>
  );
}
