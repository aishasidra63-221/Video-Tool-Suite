import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { motion } from "framer-motion";
import { HelpCircle } from "lucide-react";

const FAQS = [
  {
    q: "Is this website completely free?",
    a: "Yes! VideoTools Pro is 100% free to use. There are no hidden fees, no premium subscriptions, and no limits on how many videos you can download.",
  },
  {
    q: "Do I need to create an account?",
    a: "No registration is required. You can start downloading videos immediately without providing any personal information or email addresses.",
  },
  {
    q: "Which platforms are supported?",
    a: "We currently support high-quality downloads from YouTube, TikTok, and Snapchat. We are constantly working to add more.",
  },
  {
    q: "What video quality options are available?",
    a: "Depending on the original video's source, we offer resolutions ranging from 360p up to 4K Ultra HD. The tool will automatically fetch all available qualities for you to choose from.",
  },
  {
    q: "Is it safe to use?",
    a: "Absolutely. Our site is secure, uses HTTPS, and does not contain malicious pop-ups or harmful ads. We do not store any of your downloaded videos on our servers.",
  },
  {
    q: "Can I download MP3 audio?",
    a: "Yes! For every supported video link, we provide dedicated audio extraction options, allowing you to download MP3 files in various bitrates (up to 320kbps).",
  },
  {
    q: "How to download TikTok without watermark?",
    a: "Simply paste the TikTok video URL into our downloader. Our system automatically processes the video to provide you with the clean, original watermark-free version.",
  },
  {
    q: "Is there a download limit?",
    a: "We do not enforce a strict daily limit for normal usage. You can download as many videos as you need for personal use.",
  },
  {
    q: "Does it work on mobile?",
    a: "Yes, VideoTools Pro is fully responsive and works perfectly on iOS (iPhone/iPad) and Android devices through any modern mobile web browser.",
  },
];

export default function Faq() {
  return (
    <div className="container mx-auto px-4 py-20 max-w-4xl">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/20 mb-6">
            <HelpCircle className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold mb-4 text-gradient inline-block">
            FAQ
          </h1>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto">
            Frequently Asked Questions — everything you need to know about VideoTools Pro.
          </p>
        </div>

        <div className="glass rounded-3xl p-6 md:p-8">
          <Accordion type="single" collapsible className="w-full">
            {FAQS.map((faq, i) => (
              <AccordionItem key={i} value={`item-${i}`} className="border-white/10">
                <AccordionTrigger className="text-left text-base md:text-lg font-semibold hover:text-primary transition-colors py-4">
                  {faq.q}
                </AccordionTrigger>
                <AccordionContent className="text-muted-foreground text-base leading-relaxed pb-4">
                  {faq.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </motion.div>
    </div>
  );
}
