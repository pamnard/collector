import { lazy, Suspense } from "react";
import { BrowserRouter, Outlet, Route, Routes } from "react-router-dom";
import { AppSettingsProvider } from "./context/AppSettingsContext";
import { AppLayout } from "./components/layout/AppLayout";

const DashboardPage = lazy(() =>
  import("./pages/DashboardPage").then((m) => ({ default: m.DashboardPage })),
);
const ItemDetailPage = lazy(() =>
  import("./pages/ItemDetailPage").then((m) => ({ default: m.ItemDetailPage })),
);
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);

/** Keeps AppLayout mounted while page route chunks resolve.
 * No layout status copy — loading belongs in AlertStack (#801 regression). */
function LazyRouteOutlet() {
  return (
    <Suspense fallback={null}>
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
