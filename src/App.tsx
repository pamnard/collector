import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppSettingsProvider } from "./context/AppSettingsContext";
import { AppLayout } from "./components/layout/AppLayout";
import { DashboardPage } from "./pages/DashboardPage";
import { ItemDetailPage } from "./pages/ItemDetailPage";
import { SettingsPage } from "./pages/SettingsPage";

function App() {
  return (
    <AppSettingsProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/item/*" element={<ItemDetailPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppSettingsProvider>
  );
}

export default App;
