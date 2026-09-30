import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { applyStyles } from "./applyStyles.js";

applyStyles();
createRoot(document.getElementById("root")).render(<App />);
