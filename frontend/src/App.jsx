import { useEffect, useRef } from "react";
import { Footer } from "./layout/Footer.jsx";
import { Header } from "./layout/Header.jsx";
import { Sidebar, useSidebarPages } from "./layout/Sidebar.jsx";
import { AnnounceProvider, useAnnounce } from "./lib/announce.jsx";
import { HistoryProvider } from "./lib/history.jsx";
import { RouterProvider, Routes, useRoute } from "./lib/router.jsx";
import { ThemeProvider } from "./lib/theme.jsx";
import { ToastProvider } from "./lib/toast.jsx";
import { NOT_FOUND, ROUTES } from "./routes.js";

function Shell() {
  const { path, route, notFound } = useRoute();
  const hasSidebar = useSidebarPages().length > 0;
  const announce = useAnnounce();
  const firstRender = useRef(true);

  // After a navigation, move focus to the new page's heading and tell screen-reader users.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const heading = document.querySelector("#main h1");
    if (heading) heading.focus({ preventScroll: true });
    announce(`Navigated to ${(route || notFound).title || "Home"}`);
  }, [path]); // only a path change is a navigation

  return (
    <>
      <Header />
      <div className={hasSidebar ? "app-body has-sidebar" : "app-body"}>
        <Sidebar />
        <main id="main" className={path === "/" ? "main-full-bleed" : undefined}><Routes /></main>
      </div>
      <Footer />
    </>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <HistoryProvider>
          <AnnounceProvider>
            <RouterProvider routes={ROUTES} notFound={NOT_FOUND}>
              <Shell />
            </RouterProvider>
          </AnnounceProvider>
        </HistoryProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
