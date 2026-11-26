import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ShareViewer } from "./components/ShareViewer";
import "./styles.css";
import { initTheme } from "./theme";

initTheme();

// Paylaşım bağlantısı (…/app/?p=<belirteç>): uygulama yerine salt okunur müşteri görünümü açılır
const shareToken = /^[A-Za-z0-9_-]{16,40}$/.exec(new URLSearchParams(location.search).get("p") ?? "")?.[0];

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {shareToken ? <ShareViewer token={shareToken} /> : <App />}
  </StrictMode>,
);
