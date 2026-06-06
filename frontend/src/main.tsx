import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import "./styles/index.css";

const savedTheme = localStorage.getItem("theme") ?? "dark";

document.documentElement.classList.remove("dark", "light");
document.documentElement.classList.add(savedTheme);

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);