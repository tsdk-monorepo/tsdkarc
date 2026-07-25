// routes.test.ts
import { createClient } from "./client";
import { createTanstackClient } from "./client/tanstack-react";
import { createSwrClient } from "./client/swr";
import type { App } from "./routes";

// --- 1. Client Setup ---
const api = createClient<App>("http://localhost:5001/x");
const hooks = createTanstackClient<App>(api);
const swrHooks = createSwrClient<App>(api);

// --- 2. Hook Verification (TypeScript checks) ---
function verifyHooks() {
  try {
    hooks.hello.useQuery({ name: "world!" }); // Tanstack
    const { mutate } = hooks.updateSettings.useMutation();
    mutate({ theme: "light" });
    // @ts-expect-error
    mutate();

    const { trigger } = swrHooks.updateSettings.useMutation();
    trigger({ theme: "light" });
    // @ts-expect-error
    trigger();

    const { mutate: mutateOptional } =
      hooks.updateSettingsOptional.useMutation();
    mutateOptional({ theme: "light" });
    mutateOptional();

    const { trigger: triggerOptional } =
      swrHooks.updateSettingsOptional.useMutation();
    mutateOptional({ theme: "light" });
    mutateOptional();

    swrHooks.users.get.useQuery({ id: "1" }); // SWR nested
    const data = swrHooks.chat.useStream();
    data.start({ message: "" });
    // @ts-expect-error
    data.start({});
    // @ts-expect-error
    data.start();
  } catch (e) {
    // Suppressed for dry-run
  }
}

// --- 3. Test Runners ---
async function runStandardTests() {
  console.log("── standard tests ──");

  // Validated Query
  const helloRes = await api.hello.query({ name: "Jonathan" });
  console.log("Hello:", helloRes);

  await api.secret.query().catch(e => e);

  // @ts-expect-error
  api.hello.query().catch((e) => {});

  api.updateSettings.mutate({ theme: "light" });

  // Catching Zod Validation Error (name < 6 chars)
  const errRes = await api.hello.query({ name: "Jon" }).catch((e) => e.message);
  console.log("Validation Error Caught:", errRes);

  // Mutation & Namespace
  const mutRes = await api.updateSettings.mutate({ theme: "dark" });

  const userRes = await api.users.get.query({ id: "999" });
  console.log("Settings:", mutRes, "| User:", userRes);
}

async function runStreamTests() {
  console.log("\n── stream tests ──");

  // Successful Stream
  console.log("Chat Stream:");
  // @ts-expect-error
  api.chat.stream();
  for await (const chunk of api.chat.stream({
    message: "hello streaming world",
  })) {
    process.stdout.write(chunk.text || "");
  }
  console.log("\n");

  // Mid-flight Stream Error
  console.log("Error Stream:");
  try {
    for await (const chunk of api.errorStream.stream()) {
      console.log("Chunk:", chunk);
    }
  } catch (err: any) {
    console.log("Caught stream error mid-flight:", err.message);
  }
}

// --- 4. Execution ---
async function main() {
  verifyHooks();
  await runStandardTests();
  await runStreamTests();
  console.log("── all tests complete ──");
}

main().catch(console.error);
