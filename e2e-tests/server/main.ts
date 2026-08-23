// server.ts
//
// Fixture backend for client / SWR / React Query / Vue Query test suites.
// Domain: "PawShare" — a pet photo sharing community with login/register,
// a paginated feed, photo uploads, and a group chat backed by SSE.
//
// Route kind coverage (each kind used at least once, so generated types +
// runtime clients get exercised end to end):
//   - plain handler         → health
//   - pure query (no schema) → ping
//   - query with schema      → feed.list, feed.getPost, auth.me
//   - mutation                → auth.register, auth.login, chat.send
//   - mutation + route mw     → feed.deletePost (ownership check)
//   - mutation + waitUntil    → chat.send (background notification)
//   - stream (SSE)             → chat.streamRoom
//   - upload (multipart)       → pets.sharePhoto
//   - controlled error         → feed.getPost (404 on missing post)
//   - nested namespaces        → auth / feed / pets / chat

import {
  defineMiddleware,
  defineRouter,
  type MiddlewareNextMeta,
} from "tsdkarc-x";
import { launchApp } from "tsdkarc-x";
import { ExpressAdapter } from "tsdkarc-x/express";
import { type Request } from "express";
import { z } from "zod";

import { type RoutesOf } from "tsdkarc-x";
import { RpcError } from "tsdkarc-x/client";
import { type ContextOf, defineModule } from "tsdkarc";
import cors from "cors";

// ─── In-memory "db" module ─────────────────────────────────────────────────

interface PawUser {
  id: string;
  handle: string;
  passwordHash: string;
}

interface PawPost {
  id: string;
  authorId: string;
  petName: string;
  caption: string;
  photoUrl: string;
  createdAt: number;
}

interface ChatMessage {
  id: string;
  roomId: string;
  authorId: string;
  text: string;
  createdAt: number;
}

function genearteUsers() {
  return [
    { id: "u_1", handle: "alice_and_biscuit", passwordHash: "hashed:hunter2" },
  ];
}

function generatePosts() {
  return [
    {
      id: "post_1",
      authorId: "u_1",
      petName: "Biscuit",
      caption: "Biscuit discovered the mailbox today",
      photoUrl: "https://example.test/photos/biscuit-1.jpg",
      createdAt: 1_700_000_000_000,
    },
  ];
}

/**
 * Seed data. Deterministic so fixtures are reproducible across test runs.
 */
let USERS: PawUser[] = genearteUsers();

let POSTS: PawPost[] = generatePosts();

function resetDb() {
  USERS = genearteUsers();
  POSTS = generatePosts();
  return "ok";
}

export const dbModule = defineModule({ name: "db" }).init(() => ({
  findUserByHandle: (handle: string) =>
    USERS.find((u) => u.handle === handle) ?? null,
  findUserById: (id: string) => USERS.find((u) => u.id === id) ?? null,

  listFeed: (cursor: string | null, limit: number) => {
    const startIndex = cursor ? POSTS.findIndex((p) => p.id === cursor) + 1 : 0;
    const page = POSTS.slice(startIndex, startIndex + limit);
    const nextCursor = page.length === limit ? page[page.length - 1]?.id : null;
    return { items: page, nextCursor };
  },
  getPost: (id: string) => POSTS.find((p) => p.id === id) ?? null,
  createPost: (post: PawPost) => {
    POSTS.push(post);
    return post;
  },
  deletePost: (id: string) => {
    const idx = POSTS.findIndex((p) => p.id === id);
    if (idx === -1) return false;
    POSTS.splice(idx, 1);
    return true;
  },

  sendChatMessage: (msg: ChatMessage) => msg,
}));

// ─── Context & middleware ──────────────────────────────────────────────────

export const createContext = async (c: Request) => ({
  get token() {
    return c.header("Authorization") || null;
  },
  get ip() {
    return c.ip ?? "";
  },
});

export type BaseCtx = ContextOf<typeof dbModule>;
export type RequestMeta = Awaited<ReturnType<typeof createContext>>;

/**
 * Decodes the bearer token into a user. Fixture-only: real auth would
 * verify a signed session token, not string-match it.
 */
export const authMw = defineMiddleware<BaseCtx, RequestMeta>()(
  async (ctx, next) => {
    const userId = ctx.meta.token === "Bearer fixture-token-u_1" ? "u_1" : null;
    if (!userId) throw new RpcError("UNAUTHORIZED", "Missing or invalid token");
    return next({ user: { id: userId } });
  }
);

export const loggerMw = defineMiddleware<
  BaseCtx,
  MiddlewareNextMeta<typeof authMw>
>()(async ({ meta }, next) => {
  console.log(`[Access Log] IP: ${meta.ip} user: ${meta.user.id}`);
  return next({ traceId: `req_${Date.now()}` });
});

// ─── Router ─────────────────────────────────────────────────────────────────

const appRouter = defineRouter({
  modules: [dbModule],
  middlewares: [authMw, loggerMw],
});

const pawRoutes = appRouter.init((r) => ({
  resetDb: () => resetDb(),
  // Plain handler — no schema, no context, synchronous.
  health: () => "OK",

  // Pure query — no input schema, still reads injected context/meta.
  ping: r.query(async (_, env) => ({
    message: "pong",
    trace: env.meta.traceId,
    user: env.meta.user.id,
  })),

  auth: {
    /** Creates a new account. Returns the created user's public id + handle. */
    register: r.mutate(
      z.object({
        handle: z.string().min(3).max(24),
        password: z.string().min(8),
      }),
      async (input, env) => {
        if (env.ctx.db.findUserByHandle(input.handle)) {
          throw new RpcError("BAD_REQUEST", "Handle already taken");
        }
        return { id: `u_${Date.now()}`, handle: input.handle };
      }
    ),

    /** Exchanges credentials for a bearer token. */
    login: r.mutate(
      z.object({
        handle: z.string(),
        password: z.string(),
      }),
      async (input, env) => {
        const user = env.ctx.db.findUserByHandle(input.handle);
        if (!user || user.passwordHash !== `hashed:${input.password}`) {
          throw new RpcError("UNAUTHORIZED", "Invalid credentials");
        }
        return { token: `fixture-token-${user.id}`, userId: user.id };
      }
    ),

    /** Query with schema (input-less object, still validated) for the current user's profile. */
    me: r.query(z.object({}).optional(), async (_input, env) => {
      const user = env.ctx.db.findUserById(env.meta.user.id);
      if (!user) throw new RpcError("NOT_FOUND", "User not found");
      return { id: user.id, handle: user.handle };
    }),
  },

  feed: {
    /** Cursor-paginated feed listing — the canonical "query with schema" example. */
    list: r.query(
      z.object({
        cursor: z.string().nullable().default(null),
        limit: z.number().min(1).max(50).default(10),
      }),
      async (input, env) => env.ctx.db.listFeed(input.cursor, input.limit)
    ),

    /** Single-post lookup. Demonstrates a controlled 404 via RpcError. */
    getPost: r.query(z.object({ postId: z.string() }), async (input, env) => {
      const post = env.ctx.db.getPost(input.postId);
      if (!post) {
        throw new RpcError("NOT_FOUND", "This post has been deleted.");
      }
      return post;
    }),

    /** Mutation gated by route-level middleware (ownership check). */
    deletePost: r.mutate(
      z.object({ postId: z.string() }),
      async (input, { ctx, meta }) => {
        const post = ctx.db.getPost(input.postId);
        if (!post) throw new RpcError("NOT_FOUND", "Post does not exist");
        if (post.authorId !== meta.user.id) {
          throw new RpcError("FORBIDDEN", "You do not own this post");
        }
        ctx.db.deletePost(post.id);
        return { success: true };
      }
    ),
  },

  pets: {
    /** Multipart upload: a photo file plus caption/petName fields, coerced from strings. */
    sharePhoto: r.upload(
      z.object({
        photo: z.instanceof(File),
        petName: z.string().min(1),
        caption: z.string().max(280).default(""),
      }),
      async (input, env) => {
        const post = {
          id: `post_${Date.now()}`,
          authorId: env.meta.user.id,
          petName: input.petName,
          caption: input.caption,
          photoUrl: `https://example.test/photos/${input.photo.name}`,
          createdAt: Date.now(),
        };
        return env.ctx.db.createPost(post);
      }
    ),
  },

  chat: {
    /** Sends a message to a room; fires a background notification via waitUntil. */
    send: r.mutate(
      z.object({ roomId: z.string(), text: z.string().min(1).max(500) }),
      async (input, env) => {
        const msg: ChatMessage = {
          id: `msg_${Date.now()}`,
          roomId: input.roomId,
          authorId: env.meta.user.id,
          text: input.text,
          createdAt: Date.now(),
        };
        // HTTP response returns immediately; notification runs after response is sent.
        env.waitUntil(
          Promise.resolve().then(() =>
            console.log(
              `[notify] new message in ${input.roomId}: ${input.text}`
            )
          )
        );
        return env.ctx.db.sendChatMessage(msg);
      }
    ),

    /** SSE stream of a room's live messages — the canonical "stream" example. */
    streamRoom: r.stream(
      z.object({
        roomId: z.string(),
        maxMessages: z.number().max(20).default(5),
      }),
      async function* (input, env) {
        for (let i = 0; i < input.maxMessages; i++) {
          await new Promise((res) => setTimeout(res, 300));
          yield {
            id: `msg_${i}`,
            roomId: input.roomId,
            authorId: env.meta.user.id,
            text: `[live] message ${i} in ${input.roomId}`,
            createdAt: Date.now(),
          } satisfies ChatMessage;
        }
      }
    ),
  },
}));

// ─── Launch ─────────────────────────────────────────────────────────────────
const transport = new ExpressAdapter();
transport.app.use(cors());
async function start() {
  const app = await launchApp({
    basePath: "/api",
    transport,
    createContext,
    routes: { paw: pawRoutes },
    port: 3050,
  });
  return app;
}
start();
export type AppRoutes = RoutesOf<ReturnType<typeof start>>;
