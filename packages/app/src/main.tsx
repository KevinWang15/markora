import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "markora/styles.css";
import "markora/themes.css";
import "markora-ui/styles.css";
import "markora-extension-footnotes/styles.css";
import "markora-extension-toc/styles.css";
import "markora-extension-math/styles.css";
import "markora-extension-diagrams/styles.css";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
