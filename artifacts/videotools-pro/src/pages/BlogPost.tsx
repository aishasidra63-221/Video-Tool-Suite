import { useParams, Link } from "wouter";
import { BLOGS } from "@/data/blogs";
import { Calendar, Clock, ArrowLeft, ArrowRight, Tag } from "lucide-react";
import { useEffect } from "react";

export default function BlogPost() {
  const { slug } = useParams<{ slug: string }>();
  const post = BLOGS.find((b) => b.slug === slug);
  const currentIndex = BLOGS.findIndex((b) => b.slug === slug);
  const prevPost = currentIndex > 0 ? BLOGS[currentIndex - 1] : null;
  const nextPost = currentIndex < BLOGS.length - 1 ? BLOGS[currentIndex + 1] : null;

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [slug]);

  if (!post) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 text-center px-4">
        <div className="text-6xl">📄</div>
        <h1 className="text-3xl font-bold">Article Not Found</h1>
        <p className="text-muted-foreground">This blog post doesn't exist or may have been moved.</p>
        <Link href="/blog" className="text-primary hover:underline flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> Back to Blog
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-16">
      <div className="container mx-auto px-4 max-w-3xl">

        <Link href="/blog" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-white transition-colors mb-8">
          <ArrowLeft className="w-4 h-4" />
          Back to all guides
        </Link>

        <div className="mb-8">
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <span className="text-xs font-semibold text-primary/80 bg-primary/10 px-3 py-1 rounded-full">
              {post.category}
            </span>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Calendar className="w-3 h-3" /> {post.date}
            </span>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="w-3 h-3" /> {post.readTime}
            </span>
          </div>

          <h1 className="text-3xl md:text-5xl font-bold leading-tight mb-4">
            {post.title}
          </h1>
          <p className="text-lg text-muted-foreground leading-relaxed">
            {post.excerpt}
          </p>
        </div>

        <div className="glass rounded-2xl p-6 md:p-10 mb-10 prose-custom">
          {post.content.map((section, i) => {
            if (section.type === "h2") {
              return (
                <h2 key={i} className="text-xl md:text-2xl font-bold mt-8 mb-3 text-white">
                  {section.text}
                </h2>
              );
            }
            if (section.type === "h3") {
              return (
                <h3 key={i} className="text-lg font-semibold mt-6 mb-2 text-white/90">
                  {section.text}
                </h3>
              );
            }
            if (section.type === "p") {
              return (
                <p key={i} className="text-muted-foreground leading-relaxed mb-4">
                  {section.text}
                </p>
              );
            }
            if (section.type === "ul") {
              return (
                <ul key={i} className="list-none space-y-2 mb-4">
                  {section.items?.map((item, j) => (
                    <li key={j} className="flex items-start gap-2 text-muted-foreground">
                      <span className="text-primary mt-1 shrink-0">✓</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              );
            }
            if (section.type === "ol") {
              return (
                <ol key={i} className="list-none space-y-2 mb-4 counter-reset-none">
                  {section.items?.map((item, j) => (
                    <li key={j} className="flex items-start gap-3 text-muted-foreground">
                      <span className="shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center mt-0.5">
                        {j + 1}
                      </span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ol>
              );
            }
            return null;
          })}
        </div>

        <div className="glass rounded-2xl p-6 mb-10 text-center">
          <p className="text-lg font-semibold mb-2">Ready to download?</p>
          <p className="text-muted-foreground text-sm mb-4">
            Try VideoTools Pro now — free, instant, no login needed.
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 bg-primary hover:bg-primary/90 text-white font-semibold px-6 py-3 rounded-xl transition-colors"
          >
            Go to Downloader <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        <div className="mb-10">
          <div className="flex items-center gap-2 mb-3 text-xs text-muted-foreground">
            <Tag className="w-3 h-3" />
            Keywords:
          </div>
          <div className="flex flex-wrap gap-2">
            {post.keywords.map((kw) => (
              <span key={kw} className="text-xs bg-white/5 border border-white/10 text-muted-foreground px-3 py-1 rounded-full">
                {kw}
              </span>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {prevPost && (
            <Link href={`/blog/${prevPost.slug}`} className="glass rounded-xl p-4 hover:border-primary/30 border border-white/10 transition-all group">
              <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                <ArrowLeft className="w-3 h-3" /> Previous
              </div>
              <div className="text-sm font-semibold group-hover:text-primary transition-colors line-clamp-2">
                {prevPost.title}
              </div>
            </Link>
          )}
          {nextPost && (
            <Link href={`/blog/${nextPost.slug}`} className="glass rounded-xl p-4 hover:border-primary/30 border border-white/10 transition-all group sm:text-right sm:ml-auto w-full">
              <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1 sm:justify-end">
                Next <ArrowRight className="w-3 h-3" />
              </div>
              <div className="text-sm font-semibold group-hover:text-primary transition-colors line-clamp-2">
                {nextPost.title}
              </div>
            </Link>
          )}
        </div>

      </div>
    </div>
  );
}
