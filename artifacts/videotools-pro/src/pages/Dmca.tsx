export default function Dmca() {
  return (
    <div className="container mx-auto px-4 py-20 max-w-4xl">
      <div className="glass rounded-3xl p-8 md:p-12 prose prose-invert max-w-none">
        <h1 className="text-4xl md:text-5xl font-extrabold mb-8 text-gradient inline-block">DMCA Policy</h1>
        
        <p>
          VideoTools Pro respects the intellectual property rights of others and complies with the Digital Millennium Copyright Act (DMCA).
        </p>
        
        <div className="bg-red-500/10 border border-red-500/30 p-6 rounded-xl mb-8">
          <p className="text-red-200 m-0">
            <strong>Crucial context:</strong> VideoTools Pro does not host or store any videos, audio files, or media on our servers. We simply provide a tool that extracts public URLs. Therefore, we do not have the technical ability to "take down" content, as it resides on the servers of third-party platforms (like YouTube or TikTok).
          </p>
        </div>

        <h2>Filing a Complaint</h2>
        <p>
          If you are a copyright owner or an agent thereof, and you believe that any content accessed through our service infringes upon your copyrights, you must contact the platform hosting the original content (e.g., YouTube, TikTok, Facebook). 
        </p>
        <p>
          Taking down the content at the source will automatically render our tool unable to access or download it, effectively resolving the issue across the entire internet, not just on our website.
        </p>

        <h2>Abuse of the Tool</h2>
        <p>
          While we cannot remove content from the internet, we maintain the ability to block specific URLs or IP addresses from utilizing our service if they are found to be continually abusing the tool for widespread copyright infringement.
        </p>
        <p>
          If you have a legitimate claim regarding the systemic abuse of our service, please provide a written communication that contains:
        </p>
        <ol>
          <li>A physical or electronic signature of a person authorized to act on behalf of the owner of an exclusive right that is allegedly infringed.</li>
          <li>Identification of the copyrighted work claimed to have been infringed.</li>
          <li>Identification of the material that is claimed to be infringing or to be the subject of infringing activity, along with the specific URLs.</li>
          <li>Information reasonably sufficient to permit us to contact you, such as an address, telephone number, and, if available, an electronic mail.</li>
        </ol>

        <h2>Counter-Notice</h2>
        <p>
          Because we do not host content, the traditional DMCA counter-notice process is generally not applicable to our service. Counter-notices should be directed to the third-party platform that hosts the disputed content.
        </p>
      </div>
    </div>
  );
}
