import { motion } from "framer-motion";
import { Settings2, Download, Shield, Bell, Palette, Info, Cookie, CheckCircle2, XCircle, Loader2, ExternalLink, Trash2, RefreshCw, Lock } from "lucide-react";
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

const EXTENSION_URL =
  "https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc";

const STEPS = [
  {
    num: "1",
    label: 'Install extension',
    detail: '"Get cookies.txt LOCALLY"',
    action: { label: "Open Chrome Store →", href: EXTENSION_URL },
  },
  {
    num: "2",
    label: "Open YouTube & login",
    detail: "Apne Google account se sign in karo",
    action: { label: "Open YouTube →", href: "https://youtube.com" },
  },
  {
    num: "3",
    label: "Export cookies",
    detail: 'Extension icon click karo → "Export" dabao',
    action: null,
  },
  {
    num: "4",
    label: "Paste below & save",
    detail: "Downloaded file ka poora content yahan paste karo",
    action: null,
  },
];

function CookiesSection() {
  const [hasCookies, setHasCookies] = useState<boolean | null>(null);
  const [cookieText, setCookieText] = useState("");
  const [showInput, setShowInput] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const looksValid = cookieText.trim().includes(".youtube.com") || cookieText.trim().startsWith("# Netscape");

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
        setMessage({ type: "success", text: "✅ Cookies save ho gayi! Ab sab videos kaam karenge." });
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
      setShowInput(false);
      setMessage({ type: "success", text: "Cookies hata di gayi." });
    } catch {
      setMessage({ type: "error", text: "Failed to remove cookies." });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="glass rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 flex items-center justify-between border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-yellow-500/15 flex items-center justify-center shrink-0">
            <Lock className="w-4 h-4 text-yellow-400" />
          </div>
          <div>
            <p className="font-semibold text-white text-sm">YouTube Unlock</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Bot-blocked &amp; age-restricted videos ke liye
            </p>
          </div>
        </div>
        {hasCookies === null ? (
          <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
        ) : hasCookies ? (
          <span className="flex items-center gap-1.5 text-xs text-green-400 font-semibold bg-green-500/10 px-3 py-1 rounded-full border border-green-500/20">
            <CheckCircle2 className="w-3.5 h-3.5" /> Active
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground bg-white/5 px-3 py-1 rounded-full border border-white/10">
            <XCircle className="w-3.5 h-3.5" /> Not set
          </span>
        )}
      </div>

      {/* Message */}
      {message && (
        <div className={`mx-6 mt-4 flex items-center gap-2 text-xs px-3 py-2.5 rounded-xl ${
          message.type === "success" ? "bg-green-500/10 text-green-400 border border-green-500/20" : "bg-red-500/10 text-red-400 border border-red-500/20"
        }`}>
          {message.type === "success" ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <XCircle className="w-3.5 h-3.5 shrink-0" />}
          {message.text}
        </div>
      )}

      {/* Steps guide — always visible when not set */}
      {!hasCookies && (
        <div className="px-6 py-4 space-y-3">
          <p className="text-xs font-semibold text-white/60 uppercase tracking-wider">Sirf 4 steps — 1 minute</p>
          <div className="space-y-2">
            {STEPS.map((s) => (
              <div key={s.num} className="flex items-start gap-3 bg-white/[0.03] hover:bg-white/[0.06] rounded-xl px-4 py-3 transition-colors group">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center mt-0.5">
                  {s.num}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white font-medium">{s.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{s.detail}</p>
                </div>
                {s.action && (
                  <a
                    href={s.action.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-shrink-0 flex items-center gap-1 text-xs text-primary font-semibold hover:text-primary/80 transition-colors whitespace-nowrap"
                  >
                    {s.action.label}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Paste area */}
      {(!hasCookies || showInput) && (
        <div className="px-6 pb-4 space-y-2">
          <textarea
            value={cookieText}
            onChange={(e) => setCookieText(e.target.value)}
            placeholder={"# Netscape HTTP Cookie File\n# cookies.txt ka content yahan paste karo (Step 4)"}
            className={`w-full h-28 text-xs font-mono bg-black/40 border rounded-xl px-3 py-3 text-white/80 placeholder-white/20 focus:outline-none focus:ring-2 resize-none transition-colors ${
              cookieText && looksValid
                ? "border-green-500/40 focus:ring-green-500/30"
                : cookieText && !looksValid
                ? "border-red-500/30 focus:ring-red-500/20"
                : "border-white/15 focus:ring-primary/40"
            }`}
          />
          {cookieText && !looksValid && (
            <p className="text-xs text-red-400/80 flex items-center gap-1">
              <XCircle className="w-3 h-3" /> Yeh valid cookies.txt nahi lagta — dobara export karo
            </p>
          )}
          {cookieText && looksValid && (
            <p className="text-xs text-green-400/80 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Valid cookies detect hui — save kar sakte ho
            </p>
          )}
          <button
            onClick={saveCookies}
            disabled={saving || !cookieText.trim() || !looksValid}
            className="w-full text-sm bg-primary hover:bg-primary/90 text-white rounded-xl px-4 py-2.5 font-semibold transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : "Save Cookies & Unlock All Videos"}
          </button>
        </div>
      )}

      {/* Active state actions */}
      {hasCookies && !showInput && (
        <div className="px-6 pb-4 flex gap-2">
          <button
            onClick={() => { setShowInput(true); setMessage(null); }}
            className="flex-1 flex items-center justify-center gap-1.5 text-xs bg-white/8 hover:bg-white/12 text-white/80 border border-white/15 rounded-xl px-4 py-2.5 transition-colors font-medium"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Update Cookies
          </button>
          <button
            onClick={removeCookies}
            disabled={deleting}
            className="flex items-center gap-1.5 text-xs bg-red-500/8 hover:bg-red-500/15 text-red-400 border border-red-500/20 rounded-xl px-4 py-2.5 transition-colors font-medium disabled:opacity-50"
          >
            {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            Remove
          </button>
        </div>
      )}
      {hasCookies && showInput && (
        <div className="px-6 pb-2">
          <button
            onClick={() => { setShowInput(false); setCookieText(""); }}
            className="text-xs text-muted-foreground hover:text-white transition-colors"
          >
            Cancel
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
