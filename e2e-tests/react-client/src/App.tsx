import { useState, useEffect, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AppRoutes } from "../../server/main";
import { createClient } from "tsdkarc-x/client";
import { createSwrClient } from "tsdkarc-x/react/swr";
import { createReactQueryClient } from "tsdkarc-x/react/query";
import { useHashRouter } from "./router";

const config = {
  baseURL: "http://localhost:3050/api",
  getHeaders: () => ({
    Authorization: "Bearer fixture-token-u_1",
  }),
};

export const client = createClient<AppRoutes>(config);
export const hooks = createSwrClient<AppRoutes>(client);
export const queryHooks = createReactQueryClient<AppRoutes>(client);

/**
 * Single QueryClient instance for the whole app. Created once at module
 * level (not inside a component) so it survives hot reloads and isn't
 * recreated on every render — every queryHooks.*.useQuery/useMutation call
 * resolves this same instance via QueryClientProvider below.
 */
export const queryClient = new QueryClient();

// ─── UI Helper Components ───────────────────────────────────────────────────
// Shared between both adapters — pure presentation, no hook calls, so the
// same component works regardless of which client produced the data.

function PageHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="mb-6 border-b border-gray-100 pb-4">
      <h1 className="text-2xl font-bold text-gray-800">{title}</h1>
      <p className="text-sm text-gray-500 mt-1">{description}</p>
    </div>
  );
}

function ResultBox({
  children,
  testId,
}: {
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 font-mono text-sm break-words shadow-inner">
      {children}
    </div>
  );
}

const btnClass =
  "px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-md shadow-sm transition-colors focus:ring-2 focus:ring-indigo-500 focus:outline-none disabled:opacity-50";

// ══════════════════════════════════════════════════════════════════════════
// SWR test components (hooks.*) — unchanged from the original suite.
// ══════════════════════════════════════════════════════════════════════════

function HealthTestSwr() {
  const { data, isLoading } = hooks.paw.health.useQuery(null, {});
  return (
    <div>
      <PageHeader
        title="Health Check (SWR)"
        description="Plain handler without schema or context."
      />
      {isLoading ? (
        <div className="animate-pulse">Loading...</div>
      ) : (
        <ResultBox testId="health-result">{data}</ResultBox>
      )}
    </div>
  );
}

function PingTestSwr() {
  const { data, isLoading } = hooks.paw.ping.useQuery({}, {});
  return (
    <div>
      <PageHeader
        title="Ping Test (SWR)"
        description="Pure query testing context injection."
      />
      {isLoading ? (
        <div className="animate-pulse">Loading...</div>
      ) : (
        <ResultBox testId="ping-result">{data?.message}</ResultBox>
      )}
    </div>
  );
}

function AuthMeTestSwr() {
  const { data, isLoading } = hooks.paw.auth.me.useQuery(null, {});
  return (
    <div>
      <PageHeader
        title="Auth Me (SWR)"
        description="Query utilizing route middleware to inject the current user."
      />
      {isLoading ? (
        <div className="animate-pulse">Loading...</div>
      ) : (
        <ResultBox testId="me-result">{data?.handle}</ResultBox>
      )}
    </div>
  );
}

function FeedListTestSwr() {
  const { data, isLoading } = hooks.paw.feed.list.useQuery({ limit: 10 }, {});
  return (
    <div>
      <PageHeader
        title="Feed List (SWR)"
        description="Query with an input schema fetching seeded data."
      />
      {isLoading ? (
        <div className="animate-pulse">Loading feed...</div>
      ) : (
        <ul data-testid="feed-list" className="space-y-3 mt-4">
          {data?.items.map((post) => (
            <li
              key={post.id}
              className="p-4 bg-white border border-gray-200 rounded-lg shadow-sm flex items-center space-x-3">
              <div className="h-10 w-10 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-500 font-bold">
                {post.petName[0]}
              </div>
              <span className="text-gray-700 font-medium">{post.caption}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GetPostErrorTestSwr() {
  const { error } = hooks.paw.feed.getPost.useQuery(
    { postId: "invalid_id" },
    { shouldRetryOnError: false }
  );
  return (
    <div>
      <PageHeader
        title="Error Handling (SWR)"
        description="Controlled 404 mapped to SWR error state."
      />
      {!error ? (
        <div className="animate-pulse">Fetching...</div>
      ) : (
        <div
          data-testid="error-message"
          className="mt-4 p-4 bg-red-50 border border-red-200 text-red-600 rounded-lg font-mono text-sm">
          {(error as any).message}
        </div>
      )}
    </div>
  );
}

function RegisterTestSwr() {
  const { trigger, data, error } = hooks.paw.auth.register.useMutation();
  return (
    <div>
      <PageHeader
        title="Register User (SWR)"
        description="Mutation verifying input schemas and state updates."
      />
      <button
        data-testid="register-btn"
        className={btnClass}
        onClick={() =>
          trigger({ handle: "new_user_123", password: "password123" })
        }>
        Register New User
      </button>
      {data && <ResultBox testId="register-success">{data.handle}</ResultBox>}
      {error && (
        <div data-testid="register-error" className="mt-4 text-red-500 text-sm">
          {(error as any).message}
        </div>
      )}
    </div>
  );
}

function LoginMutationTestSwr() {
  const { trigger, data, error } = hooks.paw.auth.login.useMutation();
  return (
    <div>
      <PageHeader
        title="Login (SWR)"
        description="Exchanges credentials for a bearer token."
      />
      <button
        data-testid="login-btn"
        className={btnClass}
        onClick={() =>
          trigger({ handle: "alice_and_biscuit", password: "hunter2" })
        }>
        Login Alice
      </button>
      {data && <ResultBox testId="login-success">{data.userId}</ResultBox>}
      {error && (
        <div data-testid="login-error" className="mt-4 text-red-500 text-sm">
          {(error as any).message}
        </div>
      )}
    </div>
  );
}

function DeletePostTestSwr() {
  const { trigger, data, error } = hooks.paw.feed.deletePost.useMutation();
  return (
    <div>
      <PageHeader
        title="Delete Post (SWR)"
        description="Mutation gated by ownership route-level middleware."
      />
      <button
        data-testid="delete-btn"
        className={`${btnClass} bg-red-600 hover:bg-red-700 focus:ring-red-500`}
        onClick={() => trigger({ postId: "post_1" })}>
        Delete Seeded Post
      </button>
      {data && <ResultBox testId="delete-success">Deleted</ResultBox>}
      {error && (
        <div data-testid="delete-error" className="mt-4 text-red-500 text-sm">
          {(error as any).message}
        </div>
      )}
    </div>
  );
}

function ChatSendTestSwr() {
  const { trigger, data } = hooks.paw.chat.send.useMutation();
  return (
    <div>
      <PageHeader
        title="Send Chat (SWR)"
        description="Mutation that fires a background notification via waitUntil."
      />
      <button
        data-testid="send-btn"
        className={btnClass}
        onClick={() => trigger({ roomId: "room_1", text: "Hello World" })}>
        Send "Hello World"
      </button>
      {data && <ResultBox testId="send-success">{data.text}</ResultBox>}
    </div>
  );
}

function UploadTestSwr() {
  const { trigger, data, isMutating } = hooks.paw.pets.sharePhoto.useMutation();
  const handleUpload = async () => {
    const file = new File(["dummy content"], "test-photo.jpg", {
      type: "image/jpeg",
    });
    await trigger({ photo: file, petName: "Rex", caption: "Rex at the park!" });
  };
  return (
    <div>
      <PageHeader
        title="File Upload (SWR)"
        description="Multipart requests resolving successfully."
      />
      <button
        data-testid="upload-btn"
        className={btnClass}
        onClick={handleUpload}
        disabled={isMutating}>
        {isMutating ? "Uploading..." : "Upload Photo"}
      </button>
      {data && (
        <ResultBox testId="upload-success">
          Uploaded for {data.petName}
        </ResultBox>
      )}
    </div>
  );
}

function StreamTestSwr() {
  /**
   * chunks is already the full accumulated array in arrival order — no
   * manual useEffect/dedup needed, now that the SWR adapter's useStream
   * matches the React Query adapter's accumulation behavior.
   */
  const { chunks, done } = hooks.paw.chat.streamRoom.useStream({
    roomId: "room_1",
    maxMessages: 3,
  });

  return (
    <div>
      <PageHeader
        title="Streaming SSE (SWR)"
        description="Handles asynchronous server events natively via SWR."
      />
      <div
        data-testid="stream-container"
        className="mt-4 p-4 bg-gray-900 rounded-lg flex flex-col space-y-2">
        {chunks.map((m: any, i: number) => (
          <div
            key={m.id ?? i}
            className="stream-msg text-green-400 font-mono text-sm border-l-2 border-green-500 pl-3">
            {m.text}
          </div>
        ))}
        {done && (
          <div
            data-testid="stream-done"
            className="text-gray-400 font-mono text-xs mt-2 pt-2 border-t border-gray-700">
            [Stream Complete]
          </div>
        )}
      </div>
    </div>
  );
}

function QueryEnabledTestSwr() {
  const [enabled, setEnabled] = useState(false);
  const { data, isLoading } = hooks.paw.ping.useQuery(null, { enabled });
  return (
    <div>
      <PageHeader
        title="Deferred Query (SWR)"
        description="Ensures queries obey the `enabled: false` configuration."
      />
      <div className="flex items-center space-x-4 mb-4">
        <button
          data-testid="enable-query-btn"
          className={btnClass}
          onClick={() => setEnabled(true)}>
          Enable Query
        </button>
        <span
          className={`px-3 py-1 text-xs font-bold uppercase rounded-full ${
            enabled
              ? "bg-green-100 text-green-700"
              : "bg-gray-200 text-gray-600"
          }`}>
          <span data-testid="query-status">
            {enabled ? "Enabled" : "Disabled"}
          </span>
        </span>
      </div>
      {isLoading && enabled && (
        <div data-testid="query-loading" className="text-sm text-gray-500">
          Loading...
        </div>
      )}
      {data && <ResultBox testId="query-result">{data.message}</ResultBox>}
    </div>
  );
}

function StreamEnabledTestSwr() {
  const [enabled, setEnabled] = useState(false);
  const { chunks, done } = hooks.paw.chat.streamRoom.useStream(
    { roomId: "room_delayed", maxMessages: 2 },
    { enabled }
  );

  return (
    <div>
      <PageHeader
        title="Deferred Stream (SWR)"
        description="Ensures streams do not connect until explicitly enabled."
      />
      <div className="flex items-center space-x-4 mb-4">
        <button
          data-testid="enable-stream-btn"
          className={btnClass}
          onClick={() => setEnabled(true)}>
          Start Stream
        </button>
        <span
          className={`px-3 py-1 text-xs font-bold uppercase rounded-full ${
            enabled
              ? "bg-green-100 text-green-700"
              : "bg-gray-200 text-gray-600"
          }`}>
          <span data-testid="stream-status">
            {enabled ? "Enabled" : "Disabled"}
          </span>
        </span>
      </div>
      <div
        data-testid="delayed-stream-container"
        className="p-4 bg-gray-900 rounded-lg flex flex-col space-y-2 min-h-[100px]">
        {chunks.map((m: any, i: number) => (
          <div
            key={m.id ?? i}
            className="stream-msg text-purple-400 font-mono text-sm border-l-2 border-purple-500 pl-3">
            {m.text}
          </div>
        ))}
        {done && (
          <div
            data-testid="stream-done"
            className="text-gray-400 font-mono text-xs mt-2 pt-2 border-t border-gray-700">
            [Stream Complete]
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// React Query test components (queryHooks.*) — native TanStack Query
// conventions: mutate/mutateAsync + isPending (not trigger/isMutating),
// retry (not shouldRetryOnError), and useStream returning
// {chunks, latest, done, error} with chunks already accumulated.
// ══════════════════════════════════════════════════════════════════════════

function HealthTestQuery() {
  const { data, isLoading } = queryHooks.paw.health.useQuery(null, {});
  return (
    <div>
      <PageHeader
        title="Health Check (React Query)"
        description="Plain handler without schema or context."
      />
      {isLoading ? (
        <div className="animate-pulse">Loading...</div>
      ) : (
        <ResultBox testId="health-result">{data}</ResultBox>
      )}
    </div>
  );
}

function PingTestQuery() {
  const { data, isLoading } = queryHooks.paw.ping.useQuery({}, {});
  return (
    <div>
      <PageHeader
        title="Ping Test (React Query)"
        description="Pure query testing context injection."
      />
      {isLoading ? (
        <div className="animate-pulse">Loading...</div>
      ) : (
        <ResultBox testId="ping-result">{data?.message}</ResultBox>
      )}
    </div>
  );
}

function AuthMeTestQuery() {
  const { data, isLoading } = queryHooks.paw.auth.me.useQuery(null, {});
  return (
    <div>
      <PageHeader
        title="Auth Me (React Query)"
        description="Query utilizing route middleware to inject the current user."
      />
      {isLoading ? (
        <div className="animate-pulse">Loading...</div>
      ) : (
        <ResultBox testId="me-result">{data?.handle}</ResultBox>
      )}
    </div>
  );
}

function FeedListTestQuery() {
  const { data, isLoading } = queryHooks.paw.feed.list.useQuery(
    { limit: 10 },
    {}
  );
  return (
    <div>
      <PageHeader
        title="Feed List (React Query)"
        description="Query with an input schema fetching seeded data."
      />
      {isLoading ? (
        <div className="animate-pulse">Loading feed...</div>
      ) : (
        <ul data-testid="feed-list" className="space-y-3 mt-4">
          {data?.items.map((post) => (
            <li
              key={post.id}
              className="p-4 bg-white border border-gray-200 rounded-lg shadow-sm flex items-center space-x-3">
              <div className="h-10 w-10 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-500 font-bold">
                {post.petName[0]}
              </div>
              <span className="text-gray-700 font-medium">{post.caption}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GetPostErrorTestQuery() {
  /** TanStack Query's retry option, not SWR's shouldRetryOnError. */
  const { error } = queryHooks.paw.feed.getPost.useQuery(
    { postId: "invalid_id" },
    { retry: false }
  );
  return (
    <div>
      <PageHeader
        title="Error Handling (React Query)"
        description="Controlled 404 mapped to React Query error state."
      />
      {!error ? (
        <div className="animate-pulse">Fetching...</div>
      ) : (
        <div
          data-testid="error-message"
          className="mt-4 p-4 bg-red-50 border border-red-200 text-red-600 rounded-lg font-mono text-sm">
          {(error as any).message}
        </div>
      )}
    </div>
  );
}

function RegisterTestQuery() {
  const { mutate, data, error } = queryHooks.paw.auth.register.useMutation();
  return (
    <div>
      <PageHeader
        title="Register User (React Query)"
        description="Mutation verifying input schemas and state updates."
      />
      <button
        data-testid="register-btn"
        className={btnClass}
        onClick={() =>
          mutate({ handle: "new_user_123", password: "password123" })
        }>
        Register New User
      </button>
      {data && <ResultBox testId="register-success">{data.handle}</ResultBox>}
      {error && (
        <div data-testid="register-error" className="mt-4 text-red-500 text-sm">
          {(error as any).message}
        </div>
      )}
    </div>
  );
}

function LoginMutationTestQuery() {
  const { mutate, data, error } = queryHooks.paw.auth.login.useMutation();
  return (
    <div>
      <PageHeader
        title="Login (React Query)"
        description="Exchanges credentials for a bearer token."
      />
      <button
        data-testid="login-btn"
        className={btnClass}
        onClick={() =>
          mutate({ handle: "alice_and_biscuit", password: "hunter2" })
        }>
        Login Alice
      </button>
      {data && <ResultBox testId="login-success">{data.userId}</ResultBox>}
      {error && (
        <div data-testid="login-error" className="mt-4 text-red-500 text-sm">
          {(error as any).message}
        </div>
      )}
    </div>
  );
}

function DeletePostTestQuery() {
  const { mutate, data, error } = queryHooks.paw.feed.deletePost.useMutation();
  return (
    <div>
      <PageHeader
        title="Delete Post (React Query)"
        description="Mutation gated by ownership route-level middleware."
      />
      <button
        data-testid="delete-btn"
        className={`${btnClass} bg-red-600 hover:bg-red-700 focus:ring-red-500`}
        onClick={() => mutate({ postId: "post_1" })}>
        Delete Seeded Post
      </button>
      {data && <ResultBox testId="delete-success">Deleted</ResultBox>}
      {error && (
        <div data-testid="delete-error" className="mt-4 text-red-500 text-sm">
          {(error as any).message}
        </div>
      )}
    </div>
  );
}

function ChatSendTestQuery() {
  const { mutate, data } = queryHooks.paw.chat.send.useMutation();
  return (
    <div>
      <PageHeader
        title="Send Chat (React Query)"
        description="Mutation that fires a background notification via waitUntil."
      />
      <button
        data-testid="send-btn"
        className={btnClass}
        onClick={() => mutate({ roomId: "room_1", text: "Hello World" })}>
        Send "Hello World"
      </button>
      {data && <ResultBox testId="send-success">{data.text}</ResultBox>}
    </div>
  );
}

function UploadTestQuery() {
  const { mutateAsync, data, isPending } =
    queryHooks.paw.pets.sharePhoto.useMutation();
  const handleUpload = async () => {
    const file = new File(["dummy content"], "test-photo.jpg", {
      type: "image/jpeg",
    });
    await mutateAsync({
      photo: file,
      petName: "Rex",
      caption: "Rex at the park!",
    });
  };
  return (
    <div>
      <PageHeader
        title="File Upload (React Query)"
        description="Multipart requests resolving successfully."
      />
      <button
        data-testid="upload-btn"
        className={btnClass}
        onClick={handleUpload}
        disabled={isPending}>
        {isPending ? "Uploading..." : "Upload Photo"}
      </button>
      {data && (
        <ResultBox testId="upload-success">
          Uploaded for {data.petName}
        </ResultBox>
      )}
    </div>
  );
}

function StreamTestQuery() {
  /**
   * chunks is already the full accumulated array in arrival order — no
   * manual useEffect/dedup needed here, unlike the SWR variant.
   */
  const { chunks, done } = queryHooks.paw.chat.streamRoom.useStream({
    roomId: "room_1",
    maxMessages: 3,
  });

  return (
    <div>
      <PageHeader
        title="Streaming SSE (React Query)"
        description="Handles asynchronous server events via the React Query adapter."
      />
      <div
        data-testid="stream-container"
        className="mt-4 p-4 bg-gray-900 rounded-lg flex flex-col space-y-2">
        {chunks.map((m: any, i: number) => (
          <div
            key={m.id ?? i}
            className="stream-msg text-green-400 font-mono text-sm border-l-2 border-green-500 pl-3">
            {m.text}
          </div>
        ))}
        {done && (
          <div
            data-testid="stream-done"
            className="text-gray-400 font-mono text-xs mt-2 pt-2 border-t border-gray-700">
            [Stream Complete]
          </div>
        )}
      </div>
    </div>
  );
}

function QueryEnabledTestQuery() {
  const [enabled, setEnabled] = useState(false);
  const { data, isLoading } = queryHooks.paw.ping.useQuery(null, { enabled });
  return (
    <div>
      <PageHeader
        title="Deferred Query (React Query)"
        description="Ensures queries obey the `enabled: false` configuration."
      />
      <div className="flex items-center space-x-4 mb-4">
        <button
          data-testid="enable-query-btn"
          className={btnClass}
          onClick={() => setEnabled(true)}>
          Enable Query
        </button>
        <span
          className={`px-3 py-1 text-xs font-bold uppercase rounded-full ${
            enabled
              ? "bg-green-100 text-green-700"
              : "bg-gray-200 text-gray-600"
          }`}>
          <span data-testid="query-status">
            {enabled ? "Enabled" : "Disabled"}
          </span>
        </span>
      </div>
      {isLoading && enabled && (
        <div data-testid="query-loading" className="text-sm text-gray-500">
          Loading...
        </div>
      )}
      {data && <ResultBox testId="query-result">{data.message}</ResultBox>}
    </div>
  );
}

function StreamEnabledTestQuery() {
  const [enabled, setEnabled] = useState(false);
  const { chunks, done } = queryHooks.paw.chat.streamRoom.useStream(
    { roomId: "room_delayed", maxMessages: 2 },
    { enabled }
  );

  return (
    <div>
      <PageHeader
        title="Deferred Stream (React Query)"
        description="Ensures streams do not connect until explicitly enabled."
      />
      <div className="flex items-center space-x-4 mb-4">
        <button
          data-testid="enable-stream-btn"
          className={btnClass}
          onClick={() => setEnabled(true)}>
          Start Stream
        </button>
        <span
          className={`px-3 py-1 text-xs font-bold uppercase rounded-full ${
            enabled
              ? "bg-green-100 text-green-700"
              : "bg-gray-200 text-gray-600"
          }`}>
          <span data-testid="stream-status">
            {enabled ? "Enabled" : "Disabled"}
          </span>
        </span>
      </div>
      <div
        data-testid="delayed-stream-container"
        className="p-4 bg-gray-900 rounded-lg flex flex-col space-y-2 min-h-[100px]">
        {chunks.map((m: any, i: number) => (
          <div
            key={m.id ?? i}
            className="stream-msg text-purple-400 font-mono text-sm border-l-2 border-purple-500 pl-3">
            {m.text}
          </div>
        ))}
        {done && (
          <div
            data-testid="stream-done"
            className="text-gray-400 font-mono text-xs mt-2 pt-2 border-t border-gray-700">
            [Stream Complete]
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Route Table ────────────────────────────────────────────────────────────

/**
 * Prefixes every key in `routes` with `basePath`. Pure string mapping — no
 * adapter logic here, since the Swr/Query components above already differ
 * at the point where it matters (the hook calls themselves).
 * @param basePath  string
 * @param routes  Record<string, ReactNode>
 */
function withBasePath(basePath: string, routes: Record<string, ReactNode>) {
  const out: Record<string, ReactNode> = {};
  for (const suffix in routes) {
    out[`${basePath}/${suffix}`] = routes[suffix];
  }
  return out;
}

const SWR_ROUTES = {
  health: <HealthTestSwr />,
  ping: <PingTestSwr />,
  me: <AuthMeTestSwr />,
  feed: <FeedListTestSwr />,
  error: <GetPostErrorTestSwr />,
  register: <RegisterTestSwr />,
  login: <LoginMutationTestSwr />,
  "delete-post": <DeletePostTestSwr />,
  "chat-send": <ChatSendTestSwr />,
  upload: <UploadTestSwr />,
  stream: <StreamTestSwr />,
  "query-enabled": <QueryEnabledTestSwr />,
  "stream-enabled": <StreamEnabledTestSwr />,
};

const QUERY_ROUTES = {
  health: <HealthTestQuery />,
  ping: <PingTestQuery />,
  me: <AuthMeTestQuery />,
  feed: <FeedListTestQuery />,
  error: <GetPostErrorTestQuery />,
  register: <RegisterTestQuery />,
  login: <LoginMutationTestQuery />,
  "delete-post": <DeletePostTestQuery />,
  "chat-send": <ChatSendTestQuery />,
  upload: <UploadTestQuery />,
  stream: <StreamTestQuery />,
  "query-enabled": <QueryEnabledTestQuery />,
  "stream-enabled": <StreamEnabledTestQuery />,
};

const NAV_GROUPS = [
  { basePath: "/test", label: "SWR" },
  { basePath: "/test/tanstack-query", label: "React Query" },
];

const NAV_LINK_SUFFIXES = [
  { path: "health", label: "Health (Plain)", group: "Queries" },
  { path: "ping", label: "Ping (Pure)", group: "Queries" },
  { path: "me", label: "Auth Me (Mw)", group: "Queries" },
  { path: "feed", label: "Feed List (Schema)", group: "Queries" },
  { path: "error", label: "Error (404)", group: "Queries" },
  { path: "query-enabled", label: "Deferred Query", group: "Queries" },
  { path: "register", label: "Register User", group: "Mutations" },
  { path: "login", label: "Login", group: "Mutations" },
  { path: "delete-post", label: "Delete Post", group: "Mutations" },
  { path: "chat-send", label: "Chat Send", group: "Mutations" },
  { path: "upload", label: "Upload File", group: "Mutations" },
  { path: "stream", label: "SSE Stream", group: "Streams" },
  { path: "stream-enabled", label: "Deferred Stream", group: "Streams" },
];

// ─── Main App Router & Layout ──────────────────────────────────────────────

function App() {
  // Simple state to force nav re-renders on hash change for active link highlighting
  const [currentHash, setCurrentHash] = useState(window.location.hash || "#/");

  useEffect(() => {
    const handleHash = () => setCurrentHash(window.location.hash || "#/");
    window.addEventListener("hashchange", handleHash);
    return () => window.removeEventListener("hashchange", handleHash);
  }, []);

  const page = useHashRouter({
    "/": (
      <PageHeader
        title="Welcome to PawShare E2E"
        description="Select a route from the sidebar to begin testing."
      />
    ),
    ...withBasePath("/test", SWR_ROUTES),
    ...withBasePath("/test/tanstack-query", QUERY_ROUTES),
    "*": <PageHeader title="404" description="Test route not found." />,
  });

  return (
    <div className="min-h-screen flex bg-gray-100 font-sans text-gray-900">
      {/* Sidebar Navigation */}
      <nav className="w-64 bg-white border-r border-gray-200 shadow-sm flex flex-col fixed inset-y-0 z-10 overflow-y-auto">
        <div className="h-16 flex items-center px-6 border-b border-gray-200">
          <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-purple-600">
            PawShare Test
          </span>
          <button
            data-testid="resetdata-btn"
            className={btnClass}
            onClick={() => client.paw.resetDb.query()}>
            Enable Query
          </button>
        </div>

        <div className="flex-1 py-4 px-3 space-y-4">
          {NAV_GROUPS.map((navGroup) => (
            <div key={navGroup.basePath}>
              <div className="px-3 mb-1 text-xs font-bold uppercase tracking-wide text-gray-400">
                {navGroup.label}
              </div>
              <div className="space-y-1">
                {NAV_LINK_SUFFIXES.map((link) => {
                  const fullPath = `${navGroup.basePath}/${link.path}`;
                  const isActive = currentHash === `#${fullPath}`;
                  return (
                    <a
                      key={fullPath}
                      href={`#${fullPath}`}
                      className={`block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                        isActive
                          ? "bg-indigo-50 text-indigo-700"
                          : "text-gray-700 hover:bg-gray-100 hover:text-gray-900"
                      }`}>
                      {link.label}
                    </a>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 pl-64">
        <div className="max-w-4xl mx-auto py-10 px-8">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 min-h-[400px]">
            {page}
          </div>
        </div>
      </main>
    </div>
  );
}

/**
 * Root export. QueryClientProvider must wrap every component that calls
 * queryHooks.*.useQuery/useMutation — without it, TanStack Query's internal
 * useQueryClient() throws "No QueryClient set, use QueryClientProvider to
 * set one". SWR has no equivalent requirement, so this provider only exists
 * for the React Query routes.
 */
function AppRoot() {
  return (
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  );
}

export default AppRoot;
