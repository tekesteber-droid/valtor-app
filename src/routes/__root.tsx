import { createRootRoute, Outlet } from "@tanstack/react-router";
import "../styles.css";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Valtor" },
      {
        name: "description",
        content: "Construction bid intelligence for tender risk, pipeline, and audit workflows.",
      },
    ],
  }),
  component: () => <Outlet />,
});
