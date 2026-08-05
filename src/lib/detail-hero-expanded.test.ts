import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DETAIL_HERO_EXPANDED_STORAGE_KEY,
  readDetailHeroExpanded,
  writeDetailHeroExpanded,
} from "./detail-hero-expanded";

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

describe("detail-hero-expanded", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: createMemoryStorage(),
    });
  });

  afterEach(() => {
    localStorage.removeItem(DETAIL_HERO_EXPANDED_STORAGE_KEY);
  });

  it("defaults to expanded when key is missing", () => {
    expect(readDetailHeroExpanded()).toBe(true);
  });

  it('reads "0" as collapsed', () => {
    localStorage.setItem(DETAIL_HERO_EXPANDED_STORAGE_KEY, "0");
    expect(readDetailHeroExpanded()).toBe(false);
  });

  it('reads "1" as expanded', () => {
    localStorage.setItem(DETAIL_HERO_EXPANDED_STORAGE_KEY, "1");
    expect(readDetailHeroExpanded()).toBe(true);
  });

  it("treats invalid values as expanded", () => {
    localStorage.setItem(DETAIL_HERO_EXPANDED_STORAGE_KEY, "maybe");
    expect(readDetailHeroExpanded()).toBe(true);
  });

  it('write(false) stores "0"', () => {
    writeDetailHeroExpanded(false);
    expect(localStorage.getItem(DETAIL_HERO_EXPANDED_STORAGE_KEY)).toBe("0");
  });

  it('write(true) stores "1"', () => {
    writeDetailHeroExpanded(true);
    expect(localStorage.getItem(DETAIL_HERO_EXPANDED_STORAGE_KEY)).toBe("1");
  });
});
