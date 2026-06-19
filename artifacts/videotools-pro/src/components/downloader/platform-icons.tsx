export function YouTubeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="5" fill="#FF0000"/>
      <path d="M10 8.5L16 12L10 15.5V8.5Z" fill="white"/>
    </svg>
  );
}

export function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="5" fill="#010101"/>
      <path d="M16.8 5.8C16.1 5.0 15.7 4.0 15.7 3H13.2V15.4C13.2 16.4 12.4 17.2 11.4 17.2C10.4 17.2 9.6 16.4 9.6 15.4C9.6 14.4 10.4 13.6 11.4 13.6C11.6 13.6 11.8 13.6 12.0 13.7V11.1C11.8 11.1 11.6 11.0 11.4 11.0C9.0 11.0 7.1 12.9 7.1 15.4C7.1 17.8 9.0 19.8 11.4 19.8C13.8 19.8 15.7 17.8 15.7 15.4V9.0C16.7 9.7 17.8 10.1 19.0 10.1V7.6C18.1 7.6 17.3 7.3 16.8 5.8Z" fill="#EE1D52"/>
      <path d="M16.3 5.4C15.6 4.6 15.2 3.6 15.2 2.6H12.7V14.9C12.7 15.9 11.9 16.7 10.9 16.7C9.9 16.7 9.1 15.9 9.1 14.9C9.1 13.9 9.9 13.1 10.9 13.1C11.1 13.1 11.3 13.1 11.5 13.2V10.7C11.3 10.7 11.1 10.6 10.9 10.6C8.5 10.6 6.6 12.5 6.6 14.9C6.6 17.3 8.5 19.3 10.9 19.3C13.3 19.3 15.2 17.3 15.2 14.9V8.5C16.2 9.2 17.3 9.6 18.5 9.6V7.1C17.6 7.1 16.8 6.8 16.3 5.4Z" fill="white"/>
      <path d="M17.3 6.3C16.6 5.5 16.2 4.5 16.2 3.5H13.7V15.9C13.7 16.9 12.9 17.7 11.9 17.7C10.9 17.7 10.1 16.9 10.1 15.9C10.1 14.9 10.9 14.1 11.9 14.1C12.1 14.1 12.3 14.1 12.5 14.2V11.6C12.3 11.6 12.1 11.6 11.9 11.6C9.5 11.6 7.6 13.5 7.6 15.9C7.6 18.3 9.5 20.3 11.9 20.3C14.3 20.3 16.2 18.3 16.2 15.9V9.5C17.2 10.2 18.3 10.6 19.5 10.6V8.1C18.6 8.1 17.8 7.8 17.3 6.3Z" fill="#69C9D0"/>
    </svg>
  );
}

export function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="ig-bg" cx="30%" cy="107%" r="150%">
          <stop offset="0%" stopColor="#fdf497"/>
          <stop offset="5%" stopColor="#fdf497"/>
          <stop offset="45%" stopColor="#fd5949"/>
          <stop offset="60%" stopColor="#d6249f"/>
          <stop offset="90%" stopColor="#285AEB"/>
        </radialGradient>
      </defs>
      <rect width="24" height="24" rx="6" fill="url(#ig-bg)"/>
      <rect x="6.5" y="6.5" width="11" height="11" rx="3.5" stroke="white" strokeWidth="1.5" fill="none"/>
      <circle cx="12" cy="12" r="2.8" stroke="white" strokeWidth="1.5" fill="none"/>
      <circle cx="16.5" cy="7.5" r="0.9" fill="white"/>
    </svg>
  );
}

export function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="5" fill="#1877F2"/>
      <path d="M16 8H14C13.45 8 13 8.45 13 9V11H16L15.5 14H13V21H10V14H8V11H10V9C10 7.34 11.34 6 13 6H16V8Z" fill="white"/>
    </svg>
  );
}

export function SnapchatIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="5" fill="#FFFC00"/>
      <path d="M12 3.5C9.51 3.5 7.5 5.51 7.5 8V9.5C7.5 9.5 6.5 9.7 6.5 10.5C6.5 11.3 7.1 11.5 7.5 11.5C7.2 12.2 6.5 13.5 5.5 14C6.5 14.2 8 14 9 14C9.2 14.7 9.8 16 12 16C14.2 16 14.8 14.7 15 14C16 14 17.5 14.2 18.5 14C17.5 13.5 16.8 12.2 16.5 11.5C16.9 11.5 17.5 11.3 17.5 10.5C17.5 9.7 16.5 9.5 16.5 9.5V8C16.5 5.51 14.49 3.5 12 3.5Z" fill="#1A1A1A"/>
    </svg>
  );
}

export function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="5" fill="#000000"/>
      <path d="M17.75 4H14.75L12 7.9L9.25 4H4.25L9.5 11L4 20H7L12 13.5L17 20H20L14.5 11L17.75 4Z" fill="white"/>
    </svg>
  );
}

export const PLATFORMS = [
  {
    id: "youtube",
    name: "YouTube",
    IconComponent: YouTubeIcon,
    color: "#FF0000",
    hoverBorder: "hover:border-[#FF0000]/60",
    supports: "Videos, Shorts, 4K",
  },
  {
    id: "tiktok",
    name: "TikTok",
    IconComponent: TikTokIcon,
    color: "#69C9D0",
    hoverBorder: "hover:border-[#69C9D0]/60",
    supports: "No Watermark, HD, Audio",
  },
  {
    id: "instagram",
    name: "Instagram",
    IconComponent: InstagramIcon,
    color: "#E1306C",
    hoverBorder: "hover:border-[#E1306C]/60",
    supports: "Reels, Posts, Video",
  },
  {
    id: "snapchat",
    name: "Snapchat",
    IconComponent: SnapchatIcon,
    color: "#FFFC00",
    hoverBorder: "hover:border-[#FFFC00]/60",
    supports: "Spotlight, Stories",
  },
];
