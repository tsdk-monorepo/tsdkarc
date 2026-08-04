import { describe, test, expect, vi, beforeEach } from "vitest";

import { createClient, RpcError } from "../src/client";
/**
 * xior is mocked so tests are hermetic and don't depend on real HTTP or the
 * real xior implementation. `isAxiosError` mimics the real library's shape
 * check: an error object carrying `isAxiosError: true` and a `response`.
 *
 * `vi.mock` factories are hoisted above imports, so any mock used inside the
 * factory must itself be created via `vi.hoisted` to avoid a
 * temporal-dead-zone reference error.
 */
const { defaultRequestMock } = vi.hoisted(() => ({
  defaultRequestMock: vi.fn(async (_config: any) => ({
    data: { defaultInstance: true },
  })),
}));

vi.mock("xior", () => ({
  default: {
    create: () => ({ request: defaultRequestMock }),
  },
  isAxiosError: (error: unknown) =>
    !!error &&
    typeof error === "object" &&
    (error as any).isAxiosError === true,
}));

/**
 * Builds a fake axios-like instance whose `request` is a vi.fn mock.
 * Tests inject this via `axiosInstance` in ClientConfig to fully control
 * what executeRequest sees, independent of the module-level default instance.
 * @param impl (config) => Promise<AxiosResponse-like>
 * @returns { request: vi.Mock }
 */
function fakeHttp(impl: (config: any) => Promise<any>) {
  const request = vi.fn(impl);
  return { request };
}

/** Router shape is untyped for these runtime tests; `any` client is used. */
function client<T = any>(baseURL: string, config: any = {}): T {
  return createClient<T>(baseURL, config) as T;
}

beforeEach(() => {
  defaultRequestMock.mockClear();
});

describe("createClient — baseURL handling", () => {
  test("strips a single trailing slash from baseURL", async () => {
    const http = fakeHttp(async (config) => ({ data: config.url }));
    const c = client("https://api.example.com/", {
      axiosInstance: http as any,
    });
    await c.users.query();
    const calledUrl = http.request.mock.calls[0][0].url;
    expect(calledUrl).toBe("https://api.example.com/users");
  });

  test("accepts a single config object form (config.baseURL)", async () => {
    const http = fakeHttp(async (config) => ({ data: config.url }));
    const c = createClient<any>({
      baseURL: "https://api.example.com",
      axiosInstance: http as any,
    });
    await c.users.query();
    expect(http.request.mock.calls[0][0].url).toBe(
      "https://api.example.com/users"
    );
  });
});

describe("proxy path building", () => {
  test("nested property access builds the URL path", async () => {
    const http = fakeHttp(async (config) => ({ data: config.url }));
    const c = client("https://api.example.com", { axiosInstance: http as any });
    await c.users.profile.get.query();
    expect(http.request.mock.calls[0][0].url).toBe(
      "https://api.example.com/users/profile/get"
    );
  });

  test("last path segment selects the route kind and is not part of the URL", async () => {
    const http = fakeHttp(async (config) => ({ data: config.url }));
    const c = client("https://api.example.com", { axiosInstance: http as any });
    await c.posts.mutate({ title: "hi" });
    expect(http.request.mock.calls[0][0].url).toBe(
      "https://api.example.com/posts"
    );
  });

  test("repeated access to the same path returns a cached proxy (identity stable)", () => {
    const c = client("https://api.example.com", {});
    expect(c.users.query).toBe(c.users.query);
    expect(c.users).toBe(c.users);
  });
});

describe("query / plain — GET requests", () => {
  test("sends method GET and puts input in params", async () => {
    const http = fakeHttp(async () => ({ data: { ok: true } }));
    const c = client("https://api.example.com", { axiosInstance: http as any });
    await c.users.query({ id: 42 });
    const cfg = http.request.mock.calls[0][0];
    expect(cfg.method).toBe("GET");
    expect(cfg.params).toEqual({ id: 42 });
    expect(cfg.data).toBeUndefined();
  });

  test("plain behaves like query (GET + params)", async () => {
    const http = fakeHttp(async () => ({ data: { ok: true } }));
    const c = client("https://api.example.com", { axiosInstance: http as any });
    await c.health.plain();
    const cfg = http.request.mock.calls[0][0];
    expect(cfg.method).toBe("GET");
  });

  test("resolves with res.data", async () => {
    const http = fakeHttp(async () => ({ data: { hello: "world" } }));
    const c = client("https://api.example.com", { axiosInstance: http as any });
    const result = await c.users.query({ id: 1 });
    expect(result).toEqual({ hello: "world" });
  });

  test(
    "KNOWN BUG: falsy-but-meaningful query input (e.g. 0) is dropped from params " +
      "and incorrectly routed into `data` on a GET request, because executeRequest " +
      "checks `if (... && input)` instead of `input !== undefined`.",
    async () => {
      const http = fakeHttp(async (config) => ({ data: config }));
      const c = client("https://api.example.com", {
        axiosInstance: http as any,
      });
      await c.count.query(0);
      const cfg = http.request.mock.calls[0][0];
      expect(cfg.method).toBe("GET");
      expect(cfg.params).toBeUndefined();
      expect(cfg.data).toBe(0); // demonstrates the bug rather than desired behavior
    }
  );
});

describe("mutate — POST requests", () => {
  test("sends method POST with JSON body in data", async () => {
    const http = fakeHttp(async () => ({ data: { id: 1 } }));
    const c = client("https://api.example.com", { axiosInstance: http as any });
    await c.posts.mutate({ title: "hi" });
    const cfg = http.request.mock.calls[0][0];
    expect(cfg.method).toBe("POST");
    expect(cfg.data).toEqual({ title: "hi" });
    expect(cfg.params).toBeUndefined();
  });

  test("a File anywhere inside a mutate payload is auto-converted to multipart FormData", async () => {
    const http = fakeHttp(async () => ({ data: { ok: true } }));
    const c = client("https://api.example.com", { axiosInstance: http as any });
    const file = new File(["contents"], "avatar.png", { type: "image/png" });
    await c.profile.mutate({ name: "Ada", avatar: file });
    const cfg = http.request.mock.calls[0][0];
    expect(cfg.data).toBeInstanceOf(FormData);
    expect(cfg.data.get("name")).toBe("Ada");
    expect((cfg.data.get("avatar") as File).name).toBe("avatar.png");
  });
});

describe("upload — always multipart", () => {
  test("plain object input is converted to FormData even without a File", async () => {
    const http = fakeHttp(async () => ({ data: { ok: true } }));
    const c = client("https://api.example.com", { axiosInstance: http as any });
    await c.imports.upload({ label: "batch-1" });
    const cfg = http.request.mock.calls[0][0];
    expect(cfg.data).toBeInstanceOf(FormData);
    expect(cfg.data.get("label")).toBe("batch-1");
  });

  test("a bare File input is appended under the 'file' key", async () => {
    const http = fakeHttp(async () => ({ data: { ok: true } }));
    const c = client("https://api.example.com", { axiosInstance: http as any });
    const file = new File(["x"], "doc.pdf");
    await c.imports.upload(file);
    const cfg = http.request.mock.calls[0][0];
    expect(cfg.data).toBeInstanceOf(FormData);
    expect((cfg.data.get("file") as File).name).toBe("doc.pdf");
  });
});

describe("toFormData conversion rules", () => {
  test("Date fields are serialized to ISO strings, null/undefined are skipped, nested objects are JSON-stringified", async () => {
    const http = fakeHttp(async () => ({ data: { ok: true } }));
    const c = client("https://api.example.com", { axiosInstance: http as any });
    const when = new Date("2026-01-01T00:00:00.000Z");
    await c.events.upload({
      when,
      note: null,
      unused: undefined,
      meta: { tag: "a" },
      count: 3,
    });
    const fd: FormData = http.request.mock.calls[0][0].data;
    expect(fd.get("when")).toBe(when.toISOString());
    expect(fd.has("note")).toBe(false);
    expect(fd.has("unused")).toBe(false);
    expect(fd.get("meta")).toBe(JSON.stringify({ tag: "a" }));
    expect(fd.get("count")).toBe("3");
  });
});

describe("headers merging", () => {
  test("static config headers, getHeaders(), and per-call opts merge with per-call taking precedence", async () => {
    const http = fakeHttp(async () => ({ data: {} }));
    const c = client("https://api.example.com", {
      axiosInstance: http as any,
      headers: { "X-Static": "static", "X-Override": "static" },
      getHeaders: () => ({
        Authorization: "Bearer token",
        "X-Override": "dynamic",
      }),
    });
    await c.users.query({}, { headers: { "X-Override": "per-call" } });
    const cfg = http.request.mock.calls[0][0];
    expect(cfg.headers["X-Static"]).toBe("static");
    expect(cfg.headers.Authorization).toBe("Bearer token");
    expect(cfg.headers["X-Override"]).toBe("per-call");
  });

  test("supports an async getHeaders()", async () => {
    const http = fakeHttp(async () => ({ data: {} }));
    const c = client("https://api.example.com", {
      axiosInstance: http as any,
      getHeaders: async () => ({ Authorization: "Bearer async-token" }),
    });
    await c.users.query();
    expect(http.request.mock.calls[0][0].headers.Authorization).toBe(
      "Bearer async-token"
    );
  });
});

describe("stream — readSSE", () => {
  /** Encodes SSE `data:` frames the same way readSSE expects to decode them. */
  function sseFrame(payload: unknown) {
    return `data: ${JSON.stringify(payload)}\n\n`;
  }

  test("yields parsed payloads from a ReadableStream until __done", async () => {
    const chunks = [
      sseFrame({ n: 1 }),
      sseFrame({ n: 2 }),
      sseFrame({ __done: true }),
    ];
    const encoder = new TextEncoder();
    let i = 0;
    const reader = {
      read: async () => {
        if (i < chunks.length) {
          return { done: false, value: encoder.encode(chunks[i++]) };
        }
        return { done: true, value: undefined };
      },
      releaseLock: () => {},
    };
    const http = fakeHttp(async () => ({
      data: { getReader: () => reader },
    }));
    const c = client("https://api.example.com", { axiosInstance: http as any });
    const gen = await c.ticks.stream();
    const received: any[] = [];
    for await (const item of gen) received.push(item);
    expect(received).toEqual([{ n: 1 }, { n: 2 }]);
  });

  test("throws when the payload carries __error", async () => {
    const encoder = new TextEncoder();
    const frames = [sseFrame({ __error: "boom" })];
    let i = 0;
    const reader = {
      read: async () => {
        if (i < frames.length)
          return { done: false, value: encoder.encode(frames[i++]) };
        return { done: true, value: undefined };
      },
      releaseLock: () => {},
    };
    const http = fakeHttp(async () => ({ data: { getReader: () => reader } }));
    const c = client("https://api.example.com", { axiosInstance: http as any });
    const gen = await c.ticks.stream();
    await expect(gen.next()).rejects.toThrow("boom");
  });

  test("supports an async-iterable response body (non-browser stream)", async () => {
    async function* body() {
      yield sseFrame({ n: 1 });
      yield sseFrame({ __done: true });
    }
    const http = fakeHttp(async () => ({ data: body() }));
    const c = client("https://api.example.com", { axiosInstance: http as any });
    const gen = await c.ticks.stream();
    const received: any[] = [];
    for await (const item of gen) received.push(item);
    expect(received).toEqual([{ n: 1 }]);
  });

  test("sets responseType 'stream' on the request for stream routes", async () => {
    const reader = {
      read: async () => ({ done: true, value: undefined }),
      releaseLock: () => {},
    };
    const http = fakeHttp(async () => ({ data: { getReader: () => reader } }));
    const c = client("https://api.example.com", { axiosInstance: http as any });
    await c.ticks.stream();
    expect(http.request.mock.calls[0][0].responseType).toBe("stream");
  });

  test("throws a clear error when the response body is not a recognizable stream", async () => {
    const http = fakeHttp(async () => ({ data: { not: "a stream" } }));
    const c = client("https://api.example.com", { axiosInstance: http as any });
    const gen = await c.ticks.stream();
    await expect(gen.next()).rejects.toThrow(
      "[client] Axios response is not a stream."
    );
  });
});

describe("error handling", () => {
  test("maps a { error, message, issues } response body to RpcError", async () => {
    const http = fakeHttp(async () => {
      const err: any = new Error("Request failed with status code 400");
      err.isAxiosError = true;
      err.response = {
        data: {
          error: "VALIDATION_ERROR",
          message: "Invalid payload",
          issues: [{ path: "title" }],
        },
      };
      throw err;
    });
    const c = client("https://api.example.com", { axiosInstance: http as any });
    let caught: any;
    try {
      await c.posts.mutate({});
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RpcError);
    expect(caught.code).toBe("VALIDATION_ERROR");
    expect(caught.message).toBe("Invalid payload");
    expect(caught.issues).toEqual([{ path: "title" }]);
  });

  test("falls back to 'Request failed' when message is absent", async () => {
    const http = fakeHttp(async () => {
      const err: any = new Error("boom");
      err.isAxiosError = true;
      err.response = { data: { error: "UNKNOWN" } };
      throw err;
    });
    const c = client("https://api.example.com", { axiosInstance: http as any });
    await expect(c.posts.mutate({})).rejects.toThrow("Request failed");
  });

  test("rethrows the raw error when the response body has no `error` field", async () => {
    const http = fakeHttp(async () => {
      const err: any = new Error("network hiccup");
      err.isAxiosError = true;
      err.response = { data: "plain text error page" };
      throw err;
    });
    const c = client("https://api.example.com", { axiosInstance: http as any });
    let caught: any;
    try {
      await c.posts.mutate({});
    } catch (e) {
      caught = e;
    }
    expect(caught).not.toBeInstanceOf(RpcError);
    expect(caught.message).toBe("network hiccup");
  });

  test("rethrows non-axios errors untouched", async () => {
    const http = fakeHttp(async () => {
      throw new TypeError("totally unrelated failure");
    });
    const c = client("https://api.example.com", { axiosInstance: http as any });
    await expect(c.posts.mutate({})).rejects.toThrow(
      "totally unrelated failure"
    );
  });
});

describe("default axios instance fallback", () => {
  test("uses the module-level default instance when no axiosInstance is provided", async () => {
    const c = client("https://api.example.com", {});
    const result = await c.users.query();
    expect(defaultRequestMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ defaultInstance: true });
  });
});
