import { createClient } from "./client";
import { AppModules } from "./crud";

const api = createClient<AppModules>("http://localhost:5001");

async function test() {
  // GET /hello — input and output fully typed
  const hello = await api.get("/hello", { name: "world" });
  //    ^? { msg: string; data: { name?: string } }

  // GET /crud
  const state = await api.get("/crud");
  //    ^? { msg: string; store: number; data: {} }

  // POST /crud — increments store
  const after = await api.post("/crud");
  //    ^? { msg: string; store: number; data: {} }

  // DELETE /crud — decrements store
  const deleted = await api.delete("/crud");

  // ❌ compile error — "/unknown" is not a registered GET route
  // @ts-expect-error
  const bad = await api.get("/unknown");
}

