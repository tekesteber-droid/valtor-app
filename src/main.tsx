import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import "./styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("BidSwift AI could not start because #root was not found.");
}

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  context: {},
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);