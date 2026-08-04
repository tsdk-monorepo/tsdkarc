import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { api } from "~/tsdkarc/client";

export const Route = createFileRoute("/")({
  loader: async () => ({ message: await api.users.health.query() }),
  component: Home,
});

function Home() {
  const result = Route.useLoaderData();
  return (
    <div className="p-2">
      <h3>Welcome Home!!!</h3>
      <p>{result.message}</p>
    </div>
  );
}
