// client.ts
//
// Fixture client usage for PawShare, covering every route kind defined in
// server.ts. Structured in two parts:
//   1. run() — real runtime calls against the live server, one per route
//      kind, each annotated with which kind it exercises. This is the
//      shape client.test.ts / swr.test.ts scenarios should mirror.
//   2. wireSwrHooks() — shows how createSwrClient's proxy resolves each
//      route kind to the right hook accessor. Hooks are only referenced
//      here (not called), since useX hooks require a React render — actual
//      invocation belongs in a component-level test (see renderHook usage
//      in swr.test.tsx).

import { createClient, isRpcError } from "tsdkarc-x/client";
import type { AppRoutes } from "./main";
import { createSwrClient } from "tsdkarc-x/react/swr";

const config = {
  baseURL: "http://localhost:3050/api",
  getHeaders: () => ({
    Authorization: "Bearer fixture-token-u_1",
  }),
};

export const client = createClient<AppRoutes>(config);
export const hooks = createSwrClient<AppRoutes>(client);
export const hooks2 = createSwrClient<AppRoutes>(client);


// ─── 1. Runtime call-through, one per route kind ───────────────────────────

async function run() {
  console.log("🐾 Starting PawShare client E2E checks...\n");

  // Plain handler
  console.log("1️⃣  Plain handler: health");
  const health = await client.paw.health.query();
  console.log("   ✅", health);

  // Pure query — no input schema
  console.log("\n2️⃣  Pure query: ping");
  const ping = await client.paw.ping.query();
  console.log("   ✅", ping);

  // Mutation — register + login
  console.log("\n3️⃣  Mutation: auth.register + auth.login");
  try {
    await client.paw.auth.register.mutate({
      handle: "new_pup_owner",
      password: "supersecret",
    });
  } catch (err) {
    // Fixture seed already has this handle on repeat runs — expected on 2nd+ run.
    if (isRpcError(err)) console.log("   ⚠️ register:", err.code, err.message);
  }
  const login = await client.paw.auth.login.mutate({
    handle: "alice_and_biscuit",
    password: "hunter2",
  });
  console.log("   ✅ login token:", login.token);

  // Query with schema — paginated feed
  console.log("\n4️⃣  Query with schema: feed.list (cursor pagination)");
  const page1 = await client.paw.feed.list.query({ cursor: null, limit: 1 });
  console.log(
    "   ✅ page1:",
    page1.items.length,
    "items, nextCursor:",
    page1.nextCursor
  );

  // Controlled error — 404 on missing post
  console.log("\n5️⃣  Controlled error: feed.getPost on a missing id");
  try {
    await client.paw.feed.getPost.query({ postId: "does_not_exist" });
  } catch (err) {
    if (isRpcError(err))
      console.log("   ✅ expected 404:", err.code, err.message);
  }

  // Upload — multipart with file + coerced fields
  console.log("\n6️⃣  Upload: pets.sharePhoto");
  const dummyPhoto = new File(["fake bytes"], "biscuit-2.jpg", {
    type: "image/jpeg",
  });
  const shared = await client.paw.pets.sharePhoto.upload({
    photo: dummyPhoto,
    petName: "Biscuit",
    caption: "Zoomies in the yard",
  });
  console.log("   ✅ shared post:", shared.id, shared.photoUrl);

  // Mutation gated by route-level middleware — ownership check
  console.log("\n7️⃣  Mutation + route middleware: feed.deletePost (ownership)");
  try {
    await client.paw.feed.deletePost.mutate({ postId: "post_1" });
    console.log("   ✅ deleted own post");
  } catch (err) {
    if (isRpcError(err))
      console.log("   ❌ unexpected:", err.code, err.message);
  }
  try {
    await client.paw.feed.deletePost.mutate({ postId: "someone_elses_post" });
  } catch (err) {
    if (isRpcError(err))
      console.log("   ✅ expected FORBIDDEN/NOT_FOUND:", err.code);
  }

  // Mutation with background task — chat.send
  console.log("\n8️⃣  Mutation + waitUntil: chat.send");
  const sent = await client.paw.chat.send.mutate({
    roomId: "room_general",
    text: "Anyone else's dog afraid of the vacuum?",
  });
  console.log("   ✅ sent:", sent.id);

  // Stream — SSE group chat
  console.log("\n9️⃣  Stream: chat.streamRoom (SSE)");
  const stream = await client.paw.chat.streamRoom.stream({
    roomId: "room_general",
    maxMessages: 3,
  });
  for await (const chunk of stream) {
    console.log("   🌊", chunk.text);
  }
  console.log("   ✅ stream complete");

  console.log("\n🎉 All PawShare route kinds exercised.");
}

// ─── 2. SWR hook wiring (accessor shape only — call inside a component) ───

function wireSwrHooks() {
  const hooks = createSwrClient<AppRoutes>(client);

  // Pure/plain and schema'd queries both resolve to useQuery.
  hooks.paw.health.useQuery;
  hooks.paw.ping.useQuery;
  hooks.paw.feed.list.useQuery;
  hooks.paw.feed.getPost.useQuery;
  hooks.paw.auth.me.useQuery;

  // Mutations (plain and route-mw-gated) resolve to useMutation.
  hooks.paw.auth.register.useMutation;
  hooks.paw.auth.login.useMutation;
  hooks.paw.chat.send.useMutation;
  hooks.paw.feed.deletePost.useMutation;

  // Upload resolves to useMutation as well (accepts FormData | typed input).
  hooks.paw.pets.sharePhoto.useMutation;

  // Stream resolves to useStream.
  hooks.paw.chat.streamRoom.useStream;

  // NOTE: actually *calling* any of these (e.g. hooks.paw.feed.list.useQuery())
  // requires a React render context. See swr.test.tsx for renderHook-based
  // invocation of each of these accessors.
}
