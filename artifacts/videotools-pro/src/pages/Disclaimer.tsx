export default function Disclaimer() {
  return (
    <div className="container mx-auto px-4 py-20 max-w-4xl">
      <div className="glass border-yellow-500/30 bg-yellow-500/5 rounded-3xl p-8 md:p-12 prose prose-invert max-w-none">
        <h1 className="text-4xl md:text-5xl font-extrabold mb-8 text-yellow-400 inline-block">Disclaimer</h1>
        
        <div className="bg-black/40 p-6 rounded-xl border border-white/10 mb-8">
          <p className="text-lg font-bold text-white mb-2">Important Legal Notice</p>
          <p className="m-0 text-white/80">
            VideoTools Pro is a utility designed for educational, archival, and personal use only.
          </p>
        </div>

        <h2>1. Personal Use Only</h2>
        <p>
          The tools provided on VideoTools Pro are strictly for personal, non-commercial use. Users are permitted to download videos only for offline viewing, personal archiving, or educational purposes where fair use applies.
        </p>

        <h2>2. No Video Storage</h2>
        <p>
          <strong>VideoTools Pro does not host, store, or archive any media files on its servers.</strong> Our infrastructure acts solely as a technical conduit, parsing links provided by users and facilitating a direct download from the original content provider's content delivery network (CDN) to the user's local device.
        </p>

        <h2>3. Respect for Copyright</h2>
        <p>
          We highly respect copyright laws and the intellectual property rights of creators. Users must not use VideoTools Pro to download copyrighted material without explicit permission from the copyright holder. You bear full legal responsibility for the media you choose to download using our tool.
        </p>

        <h2>4. Not Affiliated with Platforms</h2>
        <p>
          VideoTools Pro is an independent project and is <strong>not affiliated, associated, authorized, endorsed by, or in any way officially connected with YouTube, TikTok, Instagram, Facebook, Snapchat, Twitter/X, or any of their subsidiaries or affiliates.</strong> All product names, logos, and brands are property of their respective owners.
        </p>

        <h2>5. No Guarantee of Service</h2>
        <p>
          Due to the dynamic nature of third-party platforms, we cannot guarantee that our downloader will work for every video or that all platforms will remain supported indefinitely. The service is provided "as is" without warranty of any kind.
        </p>
      </div>
    </div>
  );
}
