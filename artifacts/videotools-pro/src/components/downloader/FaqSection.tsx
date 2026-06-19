import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const FAQS = [
  {
    q: "Is this website completely free?",
    a: "Yes! VideoTools Pro is 100% free to use. There are no hidden fees, no premium subscriptions, and no limits on how many videos you can download."
  },
  {
    q: "Do I need to create an account?",
    a: "No registration is required. You can start downloading videos immediately without providing any personal information or email addresses."
  },
  {
    q: "Which platforms are supported?",
    a: "We support YouTube (up to 4K, Shorts, audio) and TikTok (no watermark, HD). YouTube works for 95%+ of public videos. TikTok downloads are fully watermark-free."
  },
  {
    q: "What video quality options are available?",
    a: "Depending on the original video's source, we offer resolutions ranging from 360p up to 4K Ultra HD. The tool will automatically fetch all available qualities for you to choose from."
  },
  {
    q: "Is it safe to use?",
    a: "Absolutely. Our site is secure, uses HTTPS, and does not contain malicious pop-ups or harmful ads. We do not store any of your downloaded videos on our servers."
  },
  {
    q: "Can I download MP3 audio?",
    a: "Yes! For every supported video link, we provide dedicated audio extraction options, allowing you to download MP3 files in various bitrates (up to 320kbps)."
  },
  {
    q: "How to download TikTok without watermark?",
    a: "Just paste any TikTok video URL. Our system uses a specialized API to deliver the clean, watermark-free HD version directly — no extra steps needed."
  },
  {
    q: "Is there a download limit?",
    a: "We do not enforce a strict daily limit for normal usage. You can download as many videos as you need for personal use."
  },
  {
    q: "Does it work on mobile?",
    a: "Yes, VideoTools Pro is fully responsive and works perfectly on iOS (iPhone/iPad) and Android devices through any modern mobile web browser."
  }
];

export function FaqSection() {
  return (
    <section className="py-24 bg-white/[0.02]">
      <div className="container mx-auto px-4 max-w-4xl">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-5xl font-bold mb-4">Frequently Asked Questions</h2>
          <p className="text-lg text-muted-foreground">Everything you need to know about VideoTools Pro.</p>
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
