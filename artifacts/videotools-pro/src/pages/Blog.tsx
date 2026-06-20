import { Link } from "wouter";
import { BLOGS } from "@/data/blogs";
import { Calendar, Clock, ArrowRight } from "lucide-react";

export default function Blog() {
  return (
    <div className="min-h-screen py-16">
      <div className="container mx-auto px-4 max-w-6xl">

        <div className="text-center mb-14">
          <span className="inline-block text-xs font-semibold tracking-widest uppercase text-primary/80 mb-3 bg-primary/10 px-4 py-1 rounded-full">
            Blog & Guides
          </span>
          <h1 className="text-4xl md:text-6xl font-bold mb-4">
            Video Download <span className="text-gradient">Guides</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Step-by-step guides on how to download YouTube, TikTok, and Snapchat videos for free — tips, tricks, and everything you need to know.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {BLOGS.map((post) => (
            <Link
              key={post.slug}
              href={`/blog/${post.slug}`}
              className="group glass rounded-2xl p-6 flex flex-col gap-4 hover:border-primary/40 border border-white/10 transition-all duration-200 hover:-translate-y-1"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-primary/80 bg-primary/10 px-3 py-1 rounded-full">
                  {post.category}
                </span>
                <span className="text-3xl">{post.coverEmoji}</span>
              </div>

              <h2 className="text-lg font-bold leading-snug group-hover:text-primary transition-colors line-clamp-2">
                {post.title}
              </h2>

              <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3">
                {post.excerpt}
              </p>

              <div className="mt-auto flex items-center justify-between text-xs text-muted-foreground pt-4 border-t border-white/10">
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {post.date}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {post.readTime}
                  </span>
                </div>
                <span className="flex items-center gap-1 text-primary font-medium">
                  Read <ArrowRight className="w-3 h-3" />
                </span>
              </div>
            </Link>
          ))}
        </div>

      </div>
    </div>
  );
}
