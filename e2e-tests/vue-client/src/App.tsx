import { defineComponent, ref, onMounted, onUnmounted } from "vue";
import { QueryClient } from "@tanstack/vue-query";
import type { AppRoutes } from "../../server/main";
import { createClient } from "tsdkarc-x/client";
import { createVueQueryClient } from "tsdkarc-x/vue/query";

const config = {
  baseURL: "http://localhost:3050/api",
  getHeaders: () => ({
    Authorization: "Bearer fixture-token-u_1",
  }),
};

export const client = createClient<AppRoutes>(config);
export const vueQueryHooks = createVueQueryClient<AppRoutes>(client);

/**
 * Single QueryClient instance for the whole app.
 */
export const queryClient = new QueryClient();

// ─── UI Helper Components ───────────────────────────────────────────────────

const PageHeader = (props: { title: string; description: string }) => (
  <div class="mb-6 border-b border-gray-100 pb-4">
    <h1 class="text-2xl font-bold text-gray-800">{props.title}</h1>
    <p class="text-sm text-gray-500 mt-1">{props.description}</p>
  </div>
);

const ResultBox = (props: { testId?: string }, { slots }: any) => (
  <div
    data-testid={props.testId}
    class="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 font-mono text-sm break-words shadow-inner">
    {slots.default?.()}
  </div>
);

const btnClass =
  "px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-md shadow-sm transition-colors focus:ring-2 focus:ring-indigo-500 focus:outline-none disabled:opacity-50";

// ══════════════════════════════════════════════════════════════════════════
// Vue Query test components (vueQueryHooks.*)
// *Note: In Vue TSX, we must use `.value` to unwrap returned refs.*
// ══════════════════════════════════════════════════════════════════════════

const HealthTestVueQuery = defineComponent({
  setup() {
    const { data, isLoading } = vueQueryHooks.paw.health.useQuery(null, {});
    return () => (
      <div>
        <PageHeader
          title="Health Check (Vue Query)"
          description="Plain handler without schema or context."
        />
        {isLoading.value ? (
          <div class="animate-pulse">Loading...</div>
        ) : (
          <ResultBox testId="health-result">{data.value}</ResultBox>
        )}
      </div>
    );
  },
});

const PingTestVueQuery = defineComponent({
  setup() {
    const { data, isLoading } = vueQueryHooks.paw.ping.useQuery({}, {});
    return () => (
      <div>
        <PageHeader
          title="Ping Test (Vue Query)"
          description="Pure query testing context injection."
        />
        {isLoading.value ? (
          <div class="animate-pulse">Loading...</div>
        ) : (
          <ResultBox testId="ping-result">{data.value?.message}</ResultBox>
        )}
      </div>
    );
  },
});

const AuthMeTestVueQuery = defineComponent({
  setup() {
    const { data, isLoading } = vueQueryHooks.paw.auth.me.useQuery(null, {});
    return () => (
      <div>
        <PageHeader
          title="Auth Me (Vue Query)"
          description="Query utilizing route middleware to inject the current user."
        />
        {isLoading.value ? (
          <div class="animate-pulse">Loading...</div>
        ) : (
          <ResultBox testId="me-result">{data.value?.handle}</ResultBox>
        )}
      </div>
    );
  },
});

const FeedListTestVueQuery = defineComponent({
  setup() {
    const { data, isLoading } = vueQueryHooks.paw.feed.list.useQuery(
      { limit: 10 },
      {}
    );
    return () => (
      <div>
        <PageHeader
          title="Feed List (Vue Query)"
          description="Query with an input schema fetching seeded data."
        />
        {isLoading.value ? (
          <div class="animate-pulse">Loading feed...</div>
        ) : (
          <ul data-testid="feed-list" class="space-y-3 mt-4">
            {data.value?.items.map((post) => (
              <li
                key={post.id}
                class="p-4 bg-white border border-gray-200 rounded-lg shadow-sm flex items-center space-x-3">
                <div class="h-10 w-10 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-500 font-bold">
                  {post.petName[0]}
                </div>
                <span class="text-gray-700 font-medium">{post.caption}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  },
});

const GetPostErrorTestVueQuery = defineComponent({
  setup() {
    const { error } = vueQueryHooks.paw.feed.getPost.useQuery(
      { postId: "invalid_id" },
      { retry: false }
    );
    return () => (
      <div>
        <PageHeader
          title="Error Handling (Vue Query)"
          description="Controlled 404 mapped to Vue Query error state."
        />
        {!error.value ? (
          <div class="animate-pulse">Fetching...</div>
        ) : (
          <div
            data-testid="error-message"
            class="mt-4 p-4 bg-red-50 border border-red-200 text-red-600 rounded-lg font-mono text-sm">
            {(error.value as any).message}
          </div>
        )}
      </div>
    );
  },
});

const RegisterTestVueQuery = defineComponent({
  setup() {
    const { mutate, data, error } =
      vueQueryHooks.paw.auth.register.useMutation();
    return () => (
      <div>
        <PageHeader
          title="Register User (Vue Query)"
          description="Mutation verifying input schemas and state updates."
        />
        <button
          data-testid="register-btn"
          class={btnClass}
          onClick={() =>
            mutate({ handle: "new_user_123", password: "password123" })
          }>
          Register New User
        </button>
        {data.value && (
          <ResultBox testId="register-success">{data.value.handle}</ResultBox>
        )}
        {error.value && (
          <div data-testid="register-error" class="mt-4 text-red-500 text-sm">
            {(error.value as any).message}
          </div>
        )}
      </div>
    );
  },
});

const LoginMutationTestVueQuery = defineComponent({
  setup() {
    const { mutate, data, error } = vueQueryHooks.paw.auth.login.useMutation();
    return () => (
      <div>
        <PageHeader
          title="Login (Vue Query)"
          description="Exchanges credentials for a bearer token."
        />
        <button
          data-testid="login-btn"
          class={btnClass}
          onClick={() =>
            mutate({ handle: "alice_and_biscuit", password: "hunter2" })
          }>
          Login Alice
        </button>
        {data.value && (
          <ResultBox testId="login-success">{data.value.userId}</ResultBox>
        )}
        {error.value && (
          <div data-testid="login-error" class="mt-4 text-red-500 text-sm">
            {(error.value as any).message}
          </div>
        )}
      </div>
    );
  },
});

const DeletePostTestVueQuery = defineComponent({
  setup() {
    const { mutate, data, error } =
      vueQueryHooks.paw.feed.deletePost.useMutation();
    return () => (
      <div>
        <PageHeader
          title="Delete Post (Vue Query)"
          description="Mutation gated by ownership route-level middleware."
        />
        <button
          data-testid="delete-btn"
          class={`${btnClass} bg-red-600 hover:bg-red-700 focus:ring-red-500`}
          onClick={() => mutate({ postId: "post_1" })}>
          Delete Seeded Post
        </button>
        {data.value && <ResultBox testId="delete-success">Deleted</ResultBox>}
        {error.value && (
          <div data-testid="delete-error" class="mt-4 text-red-500 text-sm">
            {(error.value as any).message}
          </div>
        )}
      </div>
    );
  },
});

const ChatSendTestVueQuery = defineComponent({
  setup() {
    const { mutate, data } = vueQueryHooks.paw.chat.send.useMutation();
    return () => (
      <div>
        <PageHeader
          title="Send Chat (Vue Query)"
          description="Mutation that fires a background notification via waitUntil."
        />
        <button
          data-testid="send-btn"
          class={btnClass}
          onClick={() => mutate({ roomId: "room_1", text: "Hello World" })}>
          Send "Hello World"
        </button>
        {data.value && (
          <ResultBox testId="send-success">{data.value.text}</ResultBox>
        )}
      </div>
    );
  },
});

const UploadTestVueQuery = defineComponent({
  setup() {
    const { mutateAsync, data, isPending } =
      vueQueryHooks.paw.pets.sharePhoto.useMutation();

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

    return () => (
      <div>
        <PageHeader
          title="File Upload (Vue Query)"
          description="Multipart requests resolving successfully."
        />
        <button
          data-testid="upload-btn"
          class={btnClass}
          onClick={handleUpload}
          disabled={isPending.value}>
          {isPending.value ? "Uploading..." : "Upload Photo"}
        </button>
        {data.value && (
          <ResultBox testId="upload-success">
            Uploaded for {data.value.petName}
          </ResultBox>
        )}
      </div>
    );
  },
});

const StreamTestVueQuery = defineComponent({
  setup() {
    const { chunks, done } = vueQueryHooks.paw.chat.streamRoom.useStream({
      roomId: "room_1",
      maxMessages: 3,
    });

    return () => (
      <div>
        <PageHeader
          title="Streaming SSE (Vue Query)"
          description="Handles asynchronous server events natively."
        />
        <div
          data-testid="stream-container"
          class="mt-4 p-4 bg-gray-900 rounded-lg flex flex-col space-y-2">
          {chunks.value.map((m: any, i: number) => (
            <div
              key={m.id ?? i}
              class="stream-msg text-green-400 font-mono text-sm border-l-2 border-green-500 pl-3">
              {m.text}
            </div>
          ))}
          {done.value && (
            <div
              data-testid="stream-done"
              class="text-gray-400 font-mono text-xs mt-2 pt-2 border-t border-gray-700">
              [Stream Complete]
            </div>
          )}
        </div>
      </div>
    );
  },
});

const QueryEnabledTestVueQuery = defineComponent({
  setup() {
    const enabled = ref(false);
    // Vue Query treats reactive refs properly as query options
    const { data, isLoading } = vueQueryHooks.paw.ping.useQuery(null, {
      enabled,
    });

    return () => (
      <div>
        <PageHeader
          title="Deferred Query (Vue Query)"
          description="Ensures queries obey the `enabled: false` configuration."
        />
        <div class="flex items-center space-x-4 mb-4">
          <button
            data-testid="enable-query-btn"
            class={btnClass}
            onClick={() => (enabled.value = true)}>
            Enable Query
          </button>
          <span
            class={`px-3 py-1 text-xs font-bold uppercase rounded-full ${
              enabled.value
                ? "bg-green-100 text-green-700"
                : "bg-gray-200 text-gray-600"
            }`}>
            <span data-testid="query-status">
              {enabled.value ? "Enabled" : "Disabled"}
            </span>
          </span>
        </div>
        {isLoading.value && enabled.value && (
          <div data-testid="query-loading" class="text-sm text-gray-500">
            Loading...
          </div>
        )}
        {data.value && (
          <ResultBox testId="query-result">{data.value.message}</ResultBox>
        )}
      </div>
    );
  },
});

const StreamEnabledTestVueQuery = defineComponent({
  setup() {
    const enabled = ref(false);
    const { chunks, done } = vueQueryHooks.paw.chat.streamRoom.useStream(
      { roomId: "room_delayed", maxMessages: 2 },
      { enabled }
    );

    return () => (
      <div>
        <PageHeader
          title="Deferred Stream (Vue Query)"
          description="Ensures streams do not connect until explicitly enabled."
        />
        <div class="flex items-center space-x-4 mb-4">
          <button
            data-testid="enable-stream-btn"
            class={btnClass}
            onClick={() => (enabled.value = true)}>
            Start Stream
          </button>
          <span
            class={`px-3 py-1 text-xs font-bold uppercase rounded-full ${
              enabled.value
                ? "bg-green-100 text-green-700"
                : "bg-gray-200 text-gray-600"
            }`}>
            <span data-testid="stream-status">
              {enabled.value ? "Enabled" : "Disabled"}
            </span>
          </span>
        </div>
        <div
          data-testid="delayed-stream-container"
          class="p-4 bg-gray-900 rounded-lg flex flex-col space-y-2 min-h-[100px]">
          {chunks.value.map((m: any, i: number) => (
            <div
              key={m.id ?? i}
              class="stream-msg text-purple-400 font-mono text-sm border-l-2 border-purple-500 pl-3">
              {m.text}
            </div>
          ))}
          {done.value && (
            <div
              data-testid="stream-done"
              class="text-gray-400 font-mono text-xs mt-2 pt-2 border-t border-gray-700">
              [Stream Complete]
            </div>
          )}
        </div>
      </div>
    );
  },
});

// ─── Route Table ────────────────────────────────────────────────────────────

function withBasePath(basePath: string, routes: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const suffix in routes) {
    out[`${basePath}/${suffix}`] = routes[suffix];
  }
  return out;
}

const VUE_QUERY_ROUTES = {
  health: HealthTestVueQuery,
  ping: PingTestVueQuery,
  me: AuthMeTestVueQuery,
  feed: FeedListTestVueQuery,
  error: GetPostErrorTestVueQuery,
  register: RegisterTestVueQuery,
  login: LoginMutationTestVueQuery,
  "delete-post": DeletePostTestVueQuery,
  "chat-send": ChatSendTestVueQuery,
  upload: UploadTestVueQuery,
  stream: StreamTestVueQuery,
  "query-enabled": QueryEnabledTestVueQuery,
  "stream-enabled": StreamEnabledTestVueQuery,
};

const NAV_GROUPS = [{ basePath: "/test/vue-query", label: "Vue Query" }];

const NAV_LINK_SUFFIXES = [
  { path: "health", label: "Health (Plain)" },
  { path: "ping", label: "Ping (Pure)" },
  { path: "me", label: "Auth Me (Mw)" },
  { path: "feed", label: "Feed List (Schema)" },
  { path: "error", label: "Error (404)" },
  { path: "query-enabled", label: "Deferred Query" },
  { path: "register", label: "Register User" },
  { path: "login", label: "Login" },
  { path: "delete-post", label: "Delete Post" },
  { path: "chat-send", label: "Chat Send" },
  { path: "upload", label: "Upload File" },
  { path: "stream", label: "SSE Stream" },
  { path: "stream-enabled", label: "Deferred Stream" },
];

// ─── Main App Router & Layout ──────────────────────────────────────────────

const App = defineComponent({
  setup() {
    const currentHash = ref(window.location.hash || "#/");

    onMounted(() => {
      const handleHash = () =>
        (currentHash.value = window.location.hash || "#/");
      window.addEventListener("hashchange", handleHash);
      onUnmounted(() => window.removeEventListener("hashchange", handleHash));
    });

    const routeMap = {
      ...withBasePath("/test/vue-query", VUE_QUERY_ROUTES),
    };

    return () => {
      const path = currentHash.value.replace(/^#/, "");
      const CurrentRouteComponent = routeMap[path];

      return (
        <div class="min-h-screen flex bg-gray-100 font-sans text-gray-900">
          {/* Sidebar Navigation */}
          <nav class="w-64 bg-white border-r border-gray-200 shadow-sm flex flex-col fixed inset-y-0 z-10 overflow-y-auto">
            <div class="h-16 flex items-center px-6 border-b border-gray-200 justify-between">
              <span class="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-purple-600">
                PawShare Test
              </span>
              <button
                data-testid="resetdata-btn"
                class="text-xs px-2 py-1 bg-red-600 rounded-lg text-white cursor-pointer"
                onClick={() => client.paw.resetDb.query()}>
                reset
              </button>
            </div>

            <div class="flex-1 py-4 px-3 space-y-4">
              {NAV_GROUPS.map((navGroup) => (
                <div key={navGroup.basePath}>
                  <div class="px-3 mb-1 text-xs font-bold uppercase tracking-wide text-gray-400">
                    {navGroup.label}
                  </div>
                  <div class="space-y-1">
                    {NAV_LINK_SUFFIXES.map((link) => {
                      const fullPath = `${navGroup.basePath}/${link.path}`;
                      const isActive = currentHash.value === `#${fullPath}`;
                      return (
                        <a
                          key={fullPath}
                          href={`#${fullPath}`}
                          class={`block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
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
          <main class="flex-1 pl-64">
            <div class="max-w-4xl mx-auto py-10 px-8">
              <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-8 min-h-[400px]">
                {CurrentRouteComponent ? (
                  <CurrentRouteComponent />
                ) : path === "/" || path === "" ? (
                  <PageHeader
                    title="Welcome to PawShare E2E (Vue 3)"
                    description="Select a route from the sidebar to begin testing."
                  />
                ) : (
                  <PageHeader title="404" description="Test route not found." />
                )}
              </div>
            </div>
          </main>
        </div>
      );
    };
  },
});

/**
 * Root export.
 * In Vue, we inject the QueryClient into the app tree using provideQueryClient.
 */
const AppRoot = defineComponent({
  setup() {
    return () => <App />;
  },
});

export default AppRoot;
