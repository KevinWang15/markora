import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { createThemeController } from "markora/themes";
import "markora/styles.css";
import "markora/themes.css";
import "markora-ui/styles.css";
import "./styles.css";

// The regression labs deliberately exercise unthemed and independently themed embeds.
const basename = import.meta.env.BASE_URL.replace(/\/$/u, "");
const sitePath = window.location.pathname.slice(basename.length).replace(/\/+$/u, "") || "/";
const isLab = ["/__browser", "/__dev"].includes(sitePath);
const themeController = isLab ? undefined : createThemeController({
  element: document.documentElement,
  initialTheme: "github",
  storageKey: "markora-demo.theme",
});
if (import.meta.hot) import.meta.hot.dispose(() => themeController?.destroy());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter basename={basename}>
      <App themeController={themeController} />
    </BrowserRouter>
  </React.StrictMode>,
);
