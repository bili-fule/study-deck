import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "./index.css";
import { DirectionProvider } from "@/components/foundations/direction/direction";
import { Toaster } from "@/components/base/toast/toast";
import { AppStoreProvider } from "@/store/app-store";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DirectionProvider locale="zh-CN">
      <AppStoreProvider>
        <App />
        <Toaster />
      </AppStoreProvider>
    </DirectionProvider>
  </StrictMode>,
);
