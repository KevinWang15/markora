import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { createThemeController } from "markora/themes";
import "markora/styles.css";
import "markora/themes.css";
import "markora-ui/styles.css";
import "markora-extension-footnotes/styles.css";
import "markora-extension-toc/styles.css";
import "markora-extension-math/styles.css";
import "markora-extension-diagrams/styles.css";
import "./styles.css";

const themeController = createThemeController({
  element: document.documentElement,
  storageKey: "markora-app.theme",
});
if (import.meta.hot) import.meta.hot.dispose(() => themeController.destroy());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App themeController={themeController} />
  </React.StrictMode>,
);
