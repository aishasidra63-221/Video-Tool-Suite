import { motion } from "framer-motion";
import { Settings2, Download, Shield, Bell, Palette, Info } from "lucide-react";
import { useState } from "react";

function SettingRow({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-5 border-b border-white/10 last:border-0">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-primary" />
        </div>
        <div>
          <p className="font-semibold text-white text-sm">{title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
        checked ? "bg-primary" : "bg-white/20"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-white/10 border border-white/20 text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/50 cursor-pointer"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-[#0f0f1a] text-white">
          {o.label}
        </option>
      ))}
    </select>
  );
}


export default function Settings() {
  const [autoDownload, setAutoDownload] = useState(false);
  const [notifications, setNotifications] = useState(true);
  const [safeMode, setSafeMode] = useState(true);
  const [defaultQuality, setDefaultQuality] = useState("best");
  const [defaultFormat, setDefaultFormat] = useState("mp4");

  return (
    <div className="container mx-auto px-4 py-20 max-w-2xl">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/20 mb-6">
            <Settings2 className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold mb-4 text-gradient inline-block">
            Settings
          </h1>
          <p className="text-muted-foreground">Customize your VideoTools Pro experience.</p>
        </div>

        <div className="space-y-6">
          <div className="glass rounded-2xl px-6 py-2">
            <p className="text-xs font-bold uppercase tracking-widest text-primary/70 pt-4 pb-1">
              Downloads
            </p>
            <SettingRow
              icon={Download}
              title="Default Video Quality"
              description="Automatically select this quality when available."
            >
              <Select
                value={defaultQuality}
                onChange={setDefaultQuality}
                options={[
                  { value: "best", label: "Best Available" },
                  { value: "1080p", label: "1080p Full HD" },
                  { value: "720p", label: "720p HD" },
                  { value: "480p", label: "480p SD" },
                  { value: "360p", label: "360p" },
                ]}
              />
            </SettingRow>
            <SettingRow
              icon={Palette}
              title="Default Format"
              description="Preferred container format for downloads."
            >
              <Select
                value={defaultFormat}
                onChange={setDefaultFormat}
                options={[
                  { value: "mp4", label: "MP4" },
                  { value: "mkv", label: "MKV" },
                  { value: "webm", label: "WebM" },
                ]}
              />
            </SettingRow>
            <SettingRow
              icon={Download}
              title="Auto-start Download"
              description="Begin downloading immediately after fetching video info."
            >
              <Toggle checked={autoDownload} onChange={setAutoDownload} />
            </SettingRow>
          </div>

          <div className="glass rounded-2xl px-6 py-2">
            <p className="text-xs font-bold uppercase tracking-widest text-primary/70 pt-4 pb-1">
              Privacy & Safety
            </p>
            <SettingRow
              icon={Shield}
              title="Safe Mode"
              description="Block age-restricted and sensitive content."
            >
              <Toggle checked={safeMode} onChange={setSafeMode} />
            </SettingRow>
            <SettingRow
              icon={Bell}
              title="Download Notifications"
              description="Show a notification when a download completes."
            >
              <Toggle checked={notifications} onChange={setNotifications} />
            </SettingRow>
          </div>

          <div className="glass rounded-2xl px-6 py-4">
            <div className="flex items-start gap-3">
              <Info className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
              <p className="text-xs text-muted-foreground leading-relaxed">
                Download settings are saved in your browser.
              </p>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
