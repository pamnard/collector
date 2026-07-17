import type { TagWithCount } from "@collector/core";
import type { ContentType, ItemFile, VaultMeta } from "@collector/shared";

export const MOCK_VAULT_ID = "a0000000-0000-4000-8000-000000000001";

const TAG_DEFS = [
  { id: "b0000000-0000-4000-8000-000000000001", name: "reading", color: "#6366f1" },
  { id: "b0000000-0000-4000-8000-000000000002", name: "dev", color: "#22c55e" },
  { id: "b0000000-0000-4000-8000-000000000003", name: "video", color: "#f97316" },
  { id: "b0000000-0000-4000-8000-000000000004", name: "design", color: "#ec4899" },
  { id: "b0000000-0000-4000-8000-000000000005", name: "misc", color: "#94a3b8" },
] as const;

const YOUTUBE_URLS = [
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "https://www.youtube.com/watch?v=9bZkp7q19f0",
  "https://youtu.be/jNQXAC9IVRw",
  "https://www.youtube.com/watch?v=BaW_jenozKc",
];

function mockItemId(index: number): string {
  return `c0000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function picsum(seed: string, width: number, height: number): string {
  return `https://picsum.photos/seed/${seed}/${width}/${height}`;
}

interface ItemSeed {
  title: string;
  description: string;
  content_type: ContentType;
  url?: string | null;
  thumbnail?: string | null;
  tagIndexes: number[];
  folder_path: string;
}

const ITEM_SEEDS: ItemSeed[] = [
  {
    title: "Collector masonry layout notes",
    description: "Черновик по сетке карточек и breakpoints для dashboard.",
    content_type: "note",
    tagIndexes: [1],
    folder_path: "projects/collector",
  },
  {
    title: "Offline-first vault architecture",
    description: "Индекс в SQLite, файлы на диске, rebuild при unhealthy schema.",
    content_type: "article",
    thumbnail: picsum("collector-arch", 900, 500),
    tagIndexes: [1, 3],
    folder_path: "projects/collector",
  },
  {
    title: "Rick Astley — Never Gonna Give You Up",
    description: "YouTube bookmark для проверки превью без локального cover.",
    content_type: "video",
    url: YOUTUBE_URLS[0],
    tagIndexes: [2],
    folder_path: "reading",
  },
  {
    title: "Gangnam Style",
    description: "Ещё один ролик с другим aspect ratio превью.",
    content_type: "video",
    url: YOUTUBE_URLS[1],
    tagIndexes: [2],
    folder_path: "reading",
  },
  {
    title: "Me at the zoo",
    description: "Короткий заголовок, длинное описание для проверки line-clamp на карточке grid view.",
    content_type: "video",
    url: YOUTUBE_URLS[2],
    tagIndexes: [2, 0],
    folder_path: "inbox",
  },
  {
    title: "Tall cover image sample",
    description: "Вертикальное превью для masonry.",
    content_type: "image",
    thumbnail: picsum("collector-tall", 700, 1100),
    tagIndexes: [3],
    folder_path: "projects/research",
  },
  {
    title: "Wide cover image sample",
    description: "Широкое превью.",
    content_type: "image",
    thumbnail: picsum("collector-wide", 1200, 620),
    tagIndexes: [3],
    folder_path: "projects/research",
  },
  {
    title: "Podcast episode: local-first apps",
    description: "Аудио без обложки — только иконка типа.",
    content_type: "audio",
    tagIndexes: [0, 1],
    folder_path: "reading",
  },
  {
    title: "PDF: SQLite FTS5 cheatsheet",
    description: "Документ без thumbnail.",
    content_type: "pdf",
    tagIndexes: [1],
    folder_path: "projects/research",
  },
  {
    title: "Hacker News front page",
    description: "Обычный bookmark без картинки.",
    content_type: "bookmark",
    url: "https://news.ycombinator.com/",
    tagIndexes: [0],
    folder_path: "inbox",
  },
  {
    title: "Research link without cover",
    description: "Обычная статья в projects/research.",
    content_type: "article",
    url: "https://example.com/research",
    tagIndexes: [4],
    folder_path: "projects/research",
  },
  {
    title: "Old mock note in inbox",
    description: "Ещё один seed для sidebar count.",
    content_type: "note",
    tagIndexes: [4],
    folder_path: "inbox",
  },
  {
    title: "Design system color tokens",
    description: "Карточка с несколькими тегами и обложкой.",
    content_type: "article",
    thumbnail: picsum("collector-design", 800, 900),
    tagIndexes: [3, 1, 0],
    folder_path: "projects/collector",
  },
  {
    title: "Meow",
    description: "Короткое видео.",
    content_type: "video",
    url: YOUTUBE_URLS[3],
    tagIndexes: [2],
    folder_path: "inbox",
  },
  {
    title: "React 19 release notes",
    description: "Статья с превью средней высоты.",
    content_type: "article",
    thumbnail: picsum("collector-react", 820, 680),
    tagIndexes: [1],
    folder_path: "reading",
  },
  {
    title: "Grid card hover states",
    description: "Проверка border/shadow на hover.",
    content_type: "note",
    thumbnail: picsum("collector-hover", 760, 760),
    tagIndexes: [3],
    folder_path: "projects/collector",
  },
  {
    title: "Bookmark without cover",
    description: "Закладка без картинки.",
    content_type: "bookmark",
    url: "https://developer.mozilla.org/",
    tagIndexes: [0],
    folder_path: "reading",
  },
  {
    title: "Typography scale draft",
    description: "Заметка в папке projects.",
    content_type: "note",
    tagIndexes: [3],
    folder_path: "projects",
  },
  {
    title: "Screenshot reference",
    description: "Квадратное изображение.",
    content_type: "image",
    thumbnail: picsum("collector-square", 800, 800),
    tagIndexes: [3],
    folder_path: "inbox",
  },
  {
    title: "Long title that should wrap nicely on the card without breaking the masonry column layout in the dashboard",
    description: "Длинный title stress test.",
    content_type: "article",
    thumbnail: picsum("collector-long-title", 880, 520),
    tagIndexes: [0, 1],
    folder_path: "projects/collector",
  },
  {
    title: "Minimal note",
    description: "",
    content_type: "note",
    tagIndexes: [],
    folder_path: "inbox",
  },
  {
    title: "Tagged reading list",
    description: "Несколько тегов, без url.",
    content_type: "bookmark",
    tagIndexes: [0, 4],
    folder_path: "reading",
  },
  {
    title: "Research paper scan",
    description: "PDF в research.",
    content_type: "pdf",
    thumbnail: picsum("collector-pdf", 700, 980),
    tagIndexes: [0],
    folder_path: "projects/research",
  },
  {
    title: "Ambient mix",
    description: "Audio item.",
    content_type: "audio",
    tagIndexes: [2],
    folder_path: "inbox",
  },
  {
    title: "Other misc link",
    description: "content_type other.",
    content_type: "other",
    url: "https://example.com/misc",
    tagIndexes: [4],
    folder_path: "inbox",
  },
  {
    title: "Collector issue #57",
    description: "Dev mock mode для browser UI.",
    content_type: "note",
    thumbnail: picsum("collector-issue-57", 900, 720),
    tagIndexes: [1],
    folder_path: "projects/collector",
  },
  {
    title: "Folder inbox quick capture",
    description: "Inbox folder count.",
    content_type: "note",
    tagIndexes: [],
    folder_path: "inbox",
  },
  {
    title: "Nested folder path item",
    description: "projects/research deep test.",
    content_type: "article",
    thumbnail: picsum("collector-nested", 840, 640),
    tagIndexes: [1, 0],
    folder_path: "projects/research",
  },
  {
    title: "Extra item for pagination batch boundary",
    description: "29-й элемент — всё ещё в первом batch (60).",
    content_type: "bookmark",
    url: "https://github.com/pamnard/collector/issues/57",
    tagIndexes: [1],
    folder_path: "projects/collector",
  },
  {
    title: "Thirtieth mock card",
    description: "Последний seed item.",
    content_type: "image",
    thumbnail: picsum("collector-thirty", 750, 1050),
    tagIndexes: [3, 2],
    folder_path: "reading",
  },
];

function buildItems(): ItemFile[] {
  return ITEM_SEEDS.map((seed, index) => {
    const createdAt = isoDaysAgo(ITEM_SEEDS.length - index);
    return {
      id: mockItemId(index + 1),
      vault_id: MOCK_VAULT_ID,
      title: seed.title,
      description: seed.description,
      url: seed.url ?? null,
      content_type: seed.content_type,
      source_type: seed.url?.includes("youtube") ? "youtube" : "manual",
      metadata: {},
      thumbnail: seed.thumbnail ?? null,
      tag_ids: seed.tagIndexes.map((tagIndex) => TAG_DEFS[tagIndex].id),
      collection_ids: [],
      folder_path: seed.folder_path,
      content_revision: 1,
      created_at: createdAt,
      updated_at: createdAt,
    };
  });
}

export function createMockVault(): VaultMeta {
  const timestamp = isoDaysAgo(90);
  return {
    id: MOCK_VAULT_ID,
    name: "Dev Mock Vault",
    description: "In-memory vault for browser UI development",
    is_default: true,
    schema_version: 2,
    settings: {},
    created_at: timestamp,
    updated_at: timestamp,
  };
}

export function createMockTags(items: ItemFile[]): TagWithCount[] {
  const timestamp = isoDaysAgo(90);
  return TAG_DEFS.map((tag) => ({
    id: tag.id,
    name: tag.name,
    color: tag.color,
    created_at: timestamp,
    item_count: items.filter((item) => item.tag_ids.includes(tag.id)).length,
  }));
}

export function createMockItems(): ItemFile[] {
  return buildItems();
}
