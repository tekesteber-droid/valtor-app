import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    // Automatically forwards authenticated traffic straight to the dashboard view
    throw redirect({
      to: "/dashboard",
    });
  },
  component: () => null,
});