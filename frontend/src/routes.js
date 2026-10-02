import { BACKEND_PAGES } from "./features.js";
import { AboutPage } from "./pages/About.jsx";
import { ApiDocsPage } from "./pages/ApiDocs.jsx";
import { BenchmarksPage } from "./pages/Benchmarks.jsx";
import { DashboardPage } from "./pages/Dashboard.jsx";
import { HistoryPage } from "./pages/History.jsx";
import { HomePage } from "./pages/Home.jsx";
import { HowItWorksPage } from "./pages/HowItWorks.jsx";
import { LivePage } from "./pages/Live.jsx";
import { NotFound } from "./pages/NotFound.jsx";
import { PayloadsPage } from "./pages/Payloads.jsx";
import { PlaygroundPage } from "./pages/Playground.jsx";
import { RulesPage } from "./pages/Rules.jsx";
import { ScannerPage } from "./pages/Scanner.jsx";

// { path, title, nav?, area?, component }. Routes with a `nav` label appear in the header and footer; `area: "security"`
// puts a page in the Security Dashboard area (every other page is in the main site).
// The two pages that need the FastAPI backend are left out of a build that does not have it (see features.js).
export function buildRoutes(backendPages) {
  return [
    { path: "/", title: "", component: HomePage },
    { path: "/scanner", title: "Scanner", nav: "Scanner", component: ScannerPage },
    ...(backendPages ? [
      { path: "/playground", title: "Sanitizer playground", nav: "Sanitizer", component: PlaygroundPage },
      { path: "/payloads", title: "Payloads", nav: "Payloads", component: PayloadsPage },
    ] : []),
    // /events, /history and /analytics exist only on the built-in server, so the FastAPI-backed build (backendPages) leaves the pages out
    ...(backendPages ? [] : [
      // the Security Dashboard area, in menu order; its first page is where the area switch lands
      { path: "/dashboard", title: "Dashboard", nav: "Dashboard", area: "security", component: DashboardPage },
      { path: "/history", title: "History", nav: "History", area: "security", component: HistoryPage },
      { path: "/live", title: "Live feed", nav: "Live", area: "security", component: LivePage },
    ]),
    { path: "/how-it-works", title: "How it works", nav: "How it works", component: HowItWorksPage },
    { path: "/rules", title: "Rules", nav: "Rules", component: RulesPage },
    { path: "/benchmarks", title: "Benchmarks", nav: "Benchmarks", component: BenchmarksPage },
    { path: "/api-docs", title: "API docs", nav: "API", component: ApiDocsPage },
    { path: "/about", title: "About", nav: "About", component: AboutPage },
  ];
}

export const ROUTES = buildRoutes(BACKEND_PAGES);

export const NOT_FOUND = { title: "Page not found", component: NotFound };
