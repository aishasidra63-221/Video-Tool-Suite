import { motion } from "framer-motion";
import { Settings2, Download, Shield, Bell, Palette, Info, Cookie, CheckCircle2, XCircle, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { useState, useEffect } from "react";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") + "/api";

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

function CookiesSection() {
  const [hasCookies, setHasCookies] = useState<boolean | null>(null);
  const [cookieText, setCookieText] = useState("");
  const [showInput, setShowInput] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/cookies/status`)
      .then((r) => r.json())
      .then((d) => setHasCookies(d.hasCookies))
      .catch(() => setHasCookies(false));
  }, []);

  const saveCookies = async () => {
    if (!cookieText.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      const r = await fetch(`${API_BASE}/cookies/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookies: cookieText }),
      });
      const d = await r.json();
      if (r.ok) {
        setHasCookies(true);
        setShowInput(false);
        setCookieText("");
        setMessage({ type: "success", text: "Cookies saved! Age-restricted videos will now work." });
      } else {
        setMessage({ type: "error", text: d.error || "Failed to save cookies." });
      }
    } catch {
      setMessage({ type: "error", text: "Server error. Try again." });
    } finally {
      setSaving(false);
    }
  };

  const removeCookies = async () => {
    setDeleting(true);
    setMessage(null);
    try {
      await fetch(`${API_BASE}/cookies/delete`, { method: "DELETE" });
      setHasCookies(false);
      setMessage({ type: "success", text: "Cookies removed." });
    } catch {
      setMessage({ type: "error", text: "Failed to remove cookies." });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="glass rounded-2xl px-6 py-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-yellow-500/15 flex items-center justify-center shrink-0">
            <Cookie className="w-4 h-4 text-yellow-400" />
          </div>
          <div>
            <p className="font-semibold text-white text-sm">YouTube Cookies</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Unlock age-restricted & bot-blocked videos
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasCookies === null ? (
            <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
          ) : hasCookies ? (
            <span className="flex items-center gap-1.5 text-xs text-green-400 font-medium bg-green-500/10 px-2.5 py-1 rounded-full">
              <CheckCircle2 className="w-3.5 h-3.5" /> Active
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground bg-white/5 px-2.5 py-1 rounded-full">
              <XCircle className="w-3.5 h-3.5" /> Not set
            </span>
          )}
        </div>
      </div>

      {/* Guide toggle */}
      <button
        onClick={() => setShowGuide(!showGuide)}
        className="w-full flex items-center justify-between text-xs text-primary/80 hover:text-primary transition-colors py-1"
      >
        <span>How to get YouTube cookies?</span>
        {showGuide ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>

      {showGuide && (
        <div className="bg-white/5 rounded-xl p-4 text-xs text-muted-foreground space-y-2 leading-relaxed">
          <p className="text-white font-medium">Step-by-step guide:</p>
          <ol className="list-decimal list-inside space-y-1.5">
            <li>Chrome mein <strong className="text-white">YouTube.com</strong> par jao aur login karo</li>
            <li>Chrome Extension install karo: <strong className="text-white">"Get cookies.txt LOCALLY"</strong></li>
            <li>YouTube tab par extension ka icon click karo</li>
            <li><strong className="text-white">"Export"</strong> button dabao — cookies.txt download hogi</li>
            <li>File ka poora content copy karo aur neeche paste karo</li>
          </ol>
          <p className="text-yellow-400/80 mt-2">⚠️ Sirf apne personal account ki cookies use karo.</p>
        </div>
      )}

      {message && (
        <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${
          message.type === "success" ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"
        }`}>
          {message.type === "success" ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <XCircle className="w-3.5 h-3.5 shrink-0" />}
          {message.text}
        </div>
      )}

      <div className="flex gap-2">
        {!hasCookies ? (
          <button
            onClick={() => setShowInput(!showInput)}
            className="flex-1 text-xs bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30 rounded-lg px-4 py-2 transition-colors font-medium"
          >
            {showInput ? "Cancel" : "+ Add Cookies"}
          </button>
        ) : (
          <>
            <button
              onClick={() => setShowInput(!showInput)}
              className="flex-1 text-xs bg-white/10 hover:bg-white/15 text-white border border-white/20 rounded-lg px-4 py-2 transition-colors font-medium"
            >
              {showInput ? "Cancel" : "Update Cookies"}
            </button>
            <button
              onClick={removeCookies}
              disabled={deleting}
              className="text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-lg px-4 py-2 transition-colors font-medium disabled:opacity-50"
            >
              {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Remove"}
            </button>
          </>
        )}
      </div>

      {showInput && (
        <div className="space-y-2">
          <textarea
            value={cookieText}
            onChange={(e) => setCookieText(e.target.value)}
            placeholder="# Netscape HTTP Cookie File&#10;# cookies.txt content yahan paste karo..."
            className="w-full h-32 text-xs font-mono bg-black/40 border border-white/20 rounded-xl px-3 py-3 text-white/80 placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
          />
          <button
            onClick={saveCookies}
            disabled={saving || !cookieText.trim()}
            className="w-full text-sm bg-primary hover:bg-primary/90 text-white rounded-xl px-4 py-2.5 font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : "Save Cookies"}
          </button>
        </div>
      )}
    </div>
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
          {/* YouTube Cookies — top priority */}
          <CookiesSection />

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
                Download settings are saved in your browser. Cookies are stored securely on the server and used only for video extraction.
              </p>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
