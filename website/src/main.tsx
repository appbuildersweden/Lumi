import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/plus-jakarta-sans";
import App from "./App";
import "./styles/site.css";

const container = document.getElementById("root");
if (!container) throw new Error("Kunde inte hitta elementet #root");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
