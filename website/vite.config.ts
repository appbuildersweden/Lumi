import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Lumis webbplats är ett eget projekt, skilt från Tauri-appen i repo-roten.
// Bygget blir helt statiska filer och kräver ingen server för att kunna läsas.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    // Bygget är veckans innehåll och ska gå att läsa i webbläsarens inspektör.
    sourcemap: false,
  },
});
