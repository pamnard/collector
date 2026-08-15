import { describe, expect, it, vi } from "vitest";
import {
  createTelegramBotApi,
  formatTelegramSyncError,
  isTelegramConnectivityError,
  isTelegramConnectivityErrorMessage,
  TELEGRAM_WEBHOOK_BLOCKS_POLLING_MESSAGE,
  TelegramBotApiError,
  TELEGRAM_REQUEST_TIMEOUT_MS,
} from "./telegram-bot-api.js";

describe("createTelegramBotApi (#415 / #433)", () => {
  it("getMe returns user on ok response", async () => {
    const fetchFn = vi.fn(async () =>
      Response.json({
        ok: true,
        result: { id: 1, is_bot: true, first_name: "Bot", username: "my_bot" },
      }),
    );
    const api = createTelegramBotApi({ fetchFn });
    await expect(api.getMe("tok")).resolves.toEqual({
      id: 1,
      is_bot: true,
      first_name: "Bot",
      username: "my_bot",
    });
    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.telegram.org/bottok/getMe",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws TelegramBotApiError on telegram failure", async () => {
    const fetchFn = vi.fn(async () =>
      Response.json({ ok: false, description: "Unauthorized" }, { status: 401 }),
    );
    const api = createTelegramBotApi({ fetchFn });
    await expect(api.getMe("bad")).rejects.toBeInstanceOf(TelegramBotApiError);
    await expect(api.getMe("bad")).rejects.toThrow(/Unauthorized/);
  });

  it("getUpdates posts offset and returns updates", async () => {
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { offset: number };
      expect(body.offset).toBe(42);
      return Response.json({
        ok: true,
        result: [
          {
            update_id: 42,
            message: {
              message_id: 1,
              date: 0,
              chat: { id: 9, type: "private" },
              text: "hi",
            },
          },
        ],
      });
    });
    const api = createTelegramBotApi({ fetchFn });
    const updates = await api.getUpdates("tok", { offset: 42 });
    expect(updates).toHaveLength(1);
    expect(updates[0]?.update_id).toBe(42);
  });

  it("deleteMessage calls Bot API", async () => {
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        chat_id: number;
        message_id: number;
      };
      expect(body).toEqual({ chat_id: 5, message_id: 7 });
      return Response.json({ ok: true, result: true });
    });
    const api = createTelegramBotApi({ fetchFn });
    await expect(api.deleteMessage("tok", 5, 7)).resolves.toBe(true);
  });

  it("getWebhookInfo and deleteWebhook round-trip", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes("/getWebhookInfo")) {
        return Response.json({
          ok: true,
          result: { url: "https://example.com/hook", pending_update_count: 1 },
        });
      }
      if (url.includes("/deleteWebhook")) {
        return Response.json({ ok: true, result: true });
      }
      throw new Error(`unexpected ${url}`);
    });
    const api = createTelegramBotApi({ fetchFn });
    await expect(api.getWebhookInfo("tok")).resolves.toEqual({
      url: "https://example.com/hook",
      pending_update_count: 1,
    });
    await expect(api.deleteWebhook("tok")).resolves.toBe(true);
  });

  it("ensurePollingClearsWebhook deletes only when url is set", async () => {
    const calls: string[] = [];
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes("/getWebhookInfo")) {
        calls.push("info");
        return Response.json({ ok: true, result: { url: "" } });
      }
      if (url.includes("/deleteWebhook")) {
        calls.push("delete");
        return Response.json({ ok: true, result: true });
      }
      throw new Error(`unexpected ${url}`);
    });
    const api = createTelegramBotApi({ fetchFn });
    await expect(api.ensurePollingClearsWebhook("tok")).resolves.toBe(false);
    expect(calls).toEqual(["info"]);

    fetchFn.mockImplementation(async (url: string) => {
      if (url.includes("/getWebhookInfo")) {
        calls.push("info2");
        return Response.json({
          ok: true,
          result: { url: "https://hook.example" },
        });
      }
      if (url.includes("/deleteWebhook")) {
        calls.push("delete2");
        return Response.json({ ok: true, result: true });
      }
      throw new Error(`unexpected ${url}`);
    });
    await expect(api.ensurePollingClearsWebhook("tok")).resolves.toBe(true);
    expect(calls).toEqual(["info", "info2", "delete2"]);
  });

  it("downloadFile returns bytes and rejects oversized", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes("/getFile")) {
        return Response.json({
          ok: true,
          result: {
            file_id: "f",
            file_unique_id: "u",
            file_path: "docs/a.bin",
            file_size: 4,
          },
        });
      }
      return new Response(new Uint8Array([1, 2, 3, 4]));
    });
    const api = createTelegramBotApi({ fetchFn, maxDownloadBytes: 10 });
    const file = await api.getFile("tok", "f");
    const bytes = await api.downloadFile("tok", file.file_path!);
    expect([...bytes]).toEqual([1, 2, 3, 4]);

    await expect(
      api.downloadFile("tok", "docs/a.bin", 100),
    ).rejects.toThrow(/exceeds download limit/);
  });

  it("aborts on request timeout", async () => {
    const fetchFn = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) {
            reject(new Error("missing signal"));
            return;
          }
          signal.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );
    const api = createTelegramBotApi({
      fetchFn,
      requestTimeoutMs: 20,
    });
    await expect(api.getMe("tok")).rejects.toThrow(/timed out/);
    expect(TELEGRAM_REQUEST_TIMEOUT_MS).toBe(15_000);
  });

  it("formatTelegramSyncError maps webhook Conflict", () => {
    const webhookErr = new TelegramBotApiError(
      "telegram: getUpdates failed: Conflict: can't use getUpdates method while webhook is active",
      {
        telegramDescription:
          "Conflict: can't use getUpdates method while webhook is active",
      },
    );
    expect(formatTelegramSyncError(webhookErr)).toBe(
      TELEGRAM_WEBHOOK_BLOCKS_POLLING_MESSAGE,
    );
  });

  it("marks network and timeout errors as connectivity", async () => {
    const networkApi = createTelegramBotApi({
      fetchFn: vi.fn(async () => {
        throw new Error("fetch failed");
      }),
    });
    await expect(networkApi.getMe("tok")).rejects.toMatchObject({
      connectivity: true,
      message: expect.stringContaining("network error"),
    });

    const timeoutApi = createTelegramBotApi({
      fetchFn: vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal;
            if (!signal) {
              reject(new Error("missing signal"));
              return;
            }
            signal.addEventListener("abort", () => {
              const err = new Error("aborted");
              err.name = "AbortError";
              reject(err);
            });
          }),
      ),
      requestTimeoutMs: 20,
    });
    await expect(timeoutApi.getMe("tok")).rejects.toMatchObject({
      connectivity: true,
      message: expect.stringContaining("timed out"),
    });
  });

  it("does not mark API failures as connectivity", async () => {
    const fetchFn = vi.fn(async () =>
      Response.json({ ok: false, description: "Unauthorized" }, { status: 401 }),
    );
    const api = createTelegramBotApi({ fetchFn });
    await expect(api.getMe("bad")).rejects.toMatchObject({
      connectivity: false,
    });
  });
});

describe("isTelegramConnectivityError", () => {
  it("detects connectivity flag and stable message shapes", () => {
    expect(
      isTelegramConnectivityError(
        new TelegramBotApiError("telegram: getMe network error: fetch failed", {
          connectivity: true,
        }),
      ),
    ).toBe(true);
    expect(
      isTelegramConnectivityError(
        new TelegramBotApiError("telegram: getMe failed: Unauthorized"),
      ),
    ).toBe(false);
    expect(isTelegramConnectivityError(new Error("other"))).toBe(false);

    expect(
      isTelegramConnectivityErrorMessage(
        "telegram: getMe network error: fetch failed",
      ),
    ).toBe(true);
    expect(
      isTelegramConnectivityErrorMessage(
        "telegram: getMe timed out after 15000ms",
      ),
    ).toBe(true);
    expect(
      isTelegramConnectivityErrorMessage(
        "telegram: getMe failed: Unauthorized",
      ),
    ).toBe(false);
  });
});
