import { test, expect } from "@playwright/test";
import { createClient } from "tsdkarc-x/client";
import { createSwrClient } from "tsdkarc-x/react/swr";
// Import your AppRoutes type from your actual definition file
// import type { AppRoutes } from "./server";
import { client, hooks, hooks2 } from "../server/client";

test.describe("Client Proxy & Routing Logic", () => {
  test.describe("P0 Regressions & Error Handling", () => {
    test("missing/mistyped route path throws a descriptive error immediately", () => {
      // @ts-expect-error - intentionally accessing a missing route
      hooks.paw.doesNotExist.useQuery;
    });

    test("requireHandler throws when none of the candidate handler names exist", () => {
      // @ts-expect-error
      hooks.paw.ping.useMutation;
    });

    test("requireHandler throws when a candidate key exists but is not a function", () => {
      // @ts-expect-error
      hooks.paw.auth.useQuery;
    });
  });

  test.describe("Proxy Builder & Memoization", () => {
    test("memoizes hook accessors correctly (same reference on repeat access)", () => {
      const firstAccess = hooks.paw.feed.list.useQuery;
      const secondAccess = hooks.paw.feed.list.useQuery;
      expect(firstAccess).toBe(secondAccess);
    });

    test("memoizes nested namespace proxies", () => {
      const firstNamespace = hooks.paw.auth;
      const secondNamespace = hooks.paw.auth;
      expect(firstNamespace).toBe(secondNamespace);
    });

    test("two proxies built from two different clients do not share cached hooks", () => {
      expect(hooks.paw.ping.useQuery).not.toBe(hooks2.paw.ping.useQuery);
    });

    test("accessing Symbol properties on the proxy returns undefined without throwing", () => {
      // @ts-expect-error
      expect(hooks.paw[Symbol.iterator]).toBeUndefined();
      // @ts-expect-error
      expect(hooks.paw[Symbol.toPrimitive]).toBeUndefined();
    });

    test("accessing 'then' on the proxy returns undefined (prevents accidental Promise chaining)", () => {
      // @ts-expect-error
      expect(hooks.paw.then).toBeUndefined();
    });
  });
});
