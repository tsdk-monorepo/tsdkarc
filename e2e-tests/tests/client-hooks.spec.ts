import { test, expect, type Page } from "@playwright/test";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Adjust to your Vite dev server port
const APP_URL = "http://localhost:5173";
const VUE_APP_URL = "http://localhost:5174";

/**
 * Each adapter mounts the same 13 test components under its own route
 * prefix. Running the shared assertions once per prefix keeps both
 * adapters covered without duplicating test bodies.
 */
const ADAPTERS = [
  { name: "SWR", basePath: "/test", appUrl: APP_URL },
  { name: "React Query", basePath: "/test/tanstack-query", appUrl: APP_URL },
  { name: "Vue Query", basePath: "/test/vue-query", appUrl: VUE_APP_URL },
];

for (const adapter of ADAPTERS) {
  test.describe(`PawShare ${adapter.name} adapter E2E tests`, () => {
    const goto = (page: Page, suffix: string) => {
      return page.goto(`${adapter.appUrl}/#${adapter.basePath}/${suffix}`);
    };

    test("Health: Plain handler returns expected text", async ({ page }) => {
      await goto(page, "health");
      const result = page.getByTestId("health-result");
      await expect(result).toBeVisible();
      await expect(result).toHaveText("OK");
    });

    test("Ping: Pure query resolves correctly", async ({ page }) => {
      await goto(page, "ping");
      const result = page.getByTestId("ping-result");
      await expect(result).toBeVisible();
      await expect(result).toHaveText("pong");
    });

    test("Auth Me: Middleware correctly injects context", async ({ page }) => {
      await goto(page, "me");
      const result = page.getByTestId("me-result");
      await expect(result).toBeVisible();
      await expect(result).toHaveText("alice_and_biscuit");
    });

    test("Feed List: Queries with schema list DB seeds", async ({ page }) => {
      await goto(page, "me");
      await page.getByTestId("resetdata-btn").click();
      await sleep(0.5e3);
      await goto(page, "feed");
      const feedList = page.getByTestId("feed-list");
      await expect(feedList).toBeVisible();
      await expect(feedList).toContainText(
        "Biscuit discovered the mailbox today"
      );
    });

    test("Error Handling: Controlled 404 maps to adapter error state", async ({
      page,
    }) => {
      await goto(page, "error");
      const errorMessage = page.getByTestId("error-message");
      await expect(errorMessage).toBeVisible();
      await expect(errorMessage).toHaveText("This post has been deleted.");
    });

    test("Auth Register: Validates input and creates user", async ({
      page,
    }) => {
      await goto(page, "register");
      await page.getByTestId("register-btn").click();

      const successResult = page.getByTestId("register-success");
      await expect(successResult).toBeVisible();
      await expect(successResult).toHaveText("new_user_123");
    });

    test("Login Mutation: Validates schemas and resolves with payload", async ({
      page,
    }) => {
      await goto(page, "login");
      await page.getByTestId("login-btn").click();

      const successResult = page.getByTestId("login-success");
      await expect(successResult).toBeVisible();
      await expect(successResult).toHaveText("u_1");
    });

    test("Delete Post: Ownership middleware allows deletion", async ({
      page,
    }) => {
      await goto(page, "delete-post");
      await page.getByTestId("resetdata-btn").click();
      await sleep(0.5e3);
      await page.getByTestId("delete-btn").click();

      const successResult = page.getByTestId("delete-success");
      await expect(successResult).toBeVisible();
      await expect(successResult).toHaveText("Deleted");
    });

    test("Chat Send: Resolves immediately despite background waitUntil", async ({
      page,
    }) => {
      await goto(page, "chat-send");
      await page.getByTestId("send-btn").click();

      const successResult = page.getByTestId("send-success");
      await expect(successResult).toBeVisible();
      await expect(successResult).toHaveText("Hello World");
    });

    test("File Upload: Multipart requests resolve successfully", async ({
      page,
    }) => {
      await goto(page, "upload");
      await page.getByTestId("upload-btn").click();

      const successResult = page.getByTestId("upload-success");
      await expect(successResult).toBeVisible();
      await expect(successResult).toHaveText("Uploaded for Rex");
    });

    test("Streaming SSE: useStream hooks accumulate data", async ({ page }) => {
      await goto(page, "stream");

      const streamContainer = page.getByTestId("stream-container");

      // Server yields maxMessages=3 with 300ms delays. Wait for final count.
      await expect(streamContainer.locator(".stream-msg")).toHaveCount(3, {
        timeout: 3000,
      });

      // Check specific chunk contents rendered by React
      await expect(streamContainer).toContainText("[live] message 0 in room_1");
      await expect(streamContainer).toContainText("[live] message 2 in room_1");

      // Ensure the stream finished cleanly and updated the "done" state
      const doneIndicator = page.getByTestId("stream-done");
      await expect(doneIndicator).toBeVisible();
    });

    test("Query Enabled: Defers fetching until enabled is true", async ({
      page,
    }) => {
      await goto(page, "query-enabled");

      const result = page.getByTestId("query-result");
      const status = page.getByTestId("query-status");

      // Ensure it starts disabled and no data has rendered
      await expect(status).toHaveText("Disabled");
      await expect(result).toBeHidden();

      // Click to enable the query
      await page.getByTestId("enable-query-btn").click();

      // Check that it now fetches and renders
      await expect(status).toHaveText("Enabled");
      await expect(result).toBeVisible();
      await expect(result).toHaveText("pong");
    });

    test("Stream Enabled: Defers connecting to SSE until enabled is true", async ({
      page,
    }) => {
      await goto(page, "stream-enabled");

      const container = page.getByTestId("delayed-stream-container");
      const status = page.getByTestId("stream-status");

      // Verify stream hasn't started
      await expect(status).toHaveText("Disabled");
      await expect(container.locator(".stream-msg")).toHaveCount(0);
      await expect(page.getByTestId("stream-done")).toBeHidden();

      // Click to enable the stream hook
      await page.getByTestId("enable-stream-btn").click();

      // Verify it connects and streams exactly 2 messages
      await expect(status).toHaveText("Enabled");
      await expect(container.locator(".stream-msg")).toHaveCount(2, {
        timeout: 3000,
      });

      // Ensure it successfully marks done
      await expect(page.getByTestId("stream-done")).toBeVisible();
    });
  });
}
