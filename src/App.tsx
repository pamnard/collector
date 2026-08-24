import { lazy, Suspense } from "react";
import { BrowserRouter, Outlet, Route, Routes } from "react-router-dom";
import { AppSettingsProvider } from "./context/AppSettingsContext";
import { AppLayout } from "./components/layout/AppLayout";
import { Spinner } from "./components/ui/spinner";

const DashboardPage = lazy(() =>
  import("./pages/DashboardPage").then((m) => ({ default: m.DashboardPage })),
);
const ItemDetailPage = lazy(() =>
  import("./pages/ItemDetailPage").then((m) => ({ default: m.ItemDetailPage })),
);
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);

function RouteChunkFallback() {
  return (
    <div className="flex items-center gap-2 p-4 text-sm text-neutral-500 dark:text-neutral-400">
      <Spinner className="shrink-0" />
      <span>Загрузка…</span>
    </div>
  );
}

/** Keeps AppLayout mounted while page route chunks resolve. */
function LazyRouteOutlet() {
  return (
    <Suspense fallback={<RouteChunkFallback />}>
      <Outlet />
    </Suspense>
  );
}

function App() {
  return (
    <AppSettingsProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route element={<LazyRouteOutlet />}>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/item/*" element={<ItemDetailPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AppSettingsProvider>
  );
}

export default App;
