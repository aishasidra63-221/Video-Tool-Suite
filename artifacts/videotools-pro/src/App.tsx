import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme";
import { Suspense, lazy } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import Home from "@/pages/Home";

// ── Lazy-load all non-home pages so they don't bloat the initial bundle ──
const NotFound      = lazy(() => import("@/pages/not-found"));
const Privacy       = lazy(() => import("@/pages/Privacy"));
const Terms         = lazy(() => import("@/pages/Terms"));
const Disclaimer    = lazy(() => import("@/pages/Disclaimer"));
const Dmca          = lazy(() => import("@/pages/Dmca"));
const Faq           = lazy(() => import("@/pages/Faq"));
const Settings      = lazy(() => import("@/pages/Settings"));
const Blog          = lazy(() => import("@/pages/Blog"));
const BlogPost      = lazy(() => import("@/pages/BlogPost"));
const TikTokMp3     = lazy(() => import("@/pages/TikTokMp3"));
const TikTokStories = lazy(() => import("@/pages/TikTokStories"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      retry: 1,
    },
  },
});

// Minimal fallback — no flash, just blank space
function PageFallback() {
  return <div className="min-h-[60vh]" />;
}

function Router() {
  return (
    <AppLayout>
      <Suspense fallback={<PageFallback />}>
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/blog" component={Blog} />
          <Route path="/blog/:slug" component={BlogPost} />
          <Route path="/faq" component={Faq} />
          <Route path="/settings" component={Settings} />
          <Route path="/privacy" component={Privacy} />
          <Route path="/terms" component={Terms} />
          <Route path="/disclaimer" component={Disclaimer} />
          <Route path="/dmca" component={Dmca} />
          <Route path="/download-tiktok-mp3" component={TikTokMp3} />
          <Route path="/download-tiktok-stories" component={TikTokStories} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </AppLayout>
  );
}

function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
