import { afterEach, describe, expect, it } from "vitest";
import {
  preferredProfileFromLocalState,
  resolveYoutubeCookiesBrowser,
} from "./resolve-cookies-browser.js";

describe("resolveYoutubeCookiesBrowser (#317)", () => {
  const previous = process.env.COLLECTOR_YT_COOKIES_BROWSER;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.COLLECTOR_YT_COOKIES_BROWSER;
    } else {
      process.env.COLLECTOR_YT_COOKIES_BROWSER = previous;
    }
  });

  it("honors COLLECTOR_YT_COOKIES_BROWSER override", () => {
    process.env.COLLECTOR_YT_COOKIES_BROWSER = "firefox:default";
    expect(resolveYoutubeCookiesBrowser()).toBe("firefox:default");
  });
});

describe("preferredProfileFromLocalState (#317)", () => {
  it("prefers last_active_profiles over last_used", () => {
    expect(
      preferredProfileFromLocalState({
        profile: {
          last_used: "Profile 1",
          last_active_profiles: ["Profile 3", "Profile 1"],
        },
      }),
    ).toBe("Profile 3");
  });

  it("falls back to last_used when last_active is empty", () => {
    expect(
      preferredProfileFromLocalState({
        profile: {
          last_used: "Default",
          last_active_profiles: [],
        },
      }),
    ).toBe("Default");
  });
});
