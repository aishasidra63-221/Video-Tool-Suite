import { useEffect } from "react";

interface SeoMeta {
  title: string;
  description: string;
  canonical?: string;
  ogTitle?: string;
  ogDescription?: string;
}

function setMeta(name: string, content: string, isProperty = false) {
  const attr = isProperty ? "property" : "name";
  let el = document.querySelector(`meta[${attr}="${name}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setCanonical(href: string) {
  let el = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

const DEFAULT_TITLE = "Free Video Downloader Online — YouTube, TikTok & Snapchat | VideoTools Pro";
const DEFAULT_DESC  = "Download YouTube videos in 4K/1080p, TikTok without watermark, and Snapchat Spotlight videos — 100% free, no login, no watermark, instant download.";
const DEFAULT_CANONICAL = "https://videotoolspro.replit.app/";

export function useSeoMeta({ title, description, canonical, ogTitle, ogDescription }: SeoMeta) {
  useEffect(() => {
    const prevTitle = document.title;
    const prevCanonical = document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? DEFAULT_CANONICAL;

    document.title = title;
    setMeta("description", description);
    setMeta("og:title", ogTitle ?? title, true);
    setMeta("og:description", ogDescription ?? description, true);
    setMeta("twitter:title", ogTitle ?? title);
    setMeta("twitter:description", ogDescription ?? description);
    if (canonical) setCanonical(canonical);

    return () => {
      document.title = DEFAULT_TITLE;
      setMeta("description", DEFAULT_DESC);
      setMeta("og:title", DEFAULT_TITLE, true);
      setMeta("og:description", DEFAULT_DESC, true);
      setMeta("twitter:title", DEFAULT_TITLE);
      setMeta("twitter:description", DEFAULT_DESC);
      setCanonical(prevCanonical);
    };
  }, [title, description, canonical, ogTitle, ogDescription]);
}
