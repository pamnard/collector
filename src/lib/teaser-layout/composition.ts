import blacklistJson from "./composition-blacklist.json";

export type TeaserSpan = "1x1" | "1x2" | "2x1" | "2x2";
export type ImageForm = "none" | "square" | "landscape" | "portrait";
export type TitleLen = "none" | "short" | "medium" | "long";
export type DescLen = "none" | "short" | "long";
export type ExtraFields = "none" | "date" | "date_type";

export type TeaserComposition = {
  span: TeaserSpan;
  hasImage: boolean;
  form: ImageForm;
  hasTitle: boolean;
  titleLen: TitleLen;
  desc: DescLen;
  extra: ExtraFields;
};

const SPANS: readonly TeaserSpan[] = ["1x1", "1x2", "2x1", "2x2"];
const IMAGE_FORMS: readonly ImageForm[] = ["square", "landscape", "portrait"];
const TITLE_LENS: readonly TitleLen[] = ["short", "medium", "long"];
const DESC_LENS: readonly DescLen[] = ["none", "short", "long"];
const EXTRAS: readonly ExtraFields[] = ["none", "date", "date_type"];

export const COMPOSITION_BLACKLIST: ReadonlySet<string> = new Set(
  blacklistJson,
);

export function isStructurallyValidComposition(
  composition: TeaserComposition,
): boolean {
  if (composition.hasImage) {
    if (composition.form === "none") {
      return false;
    }
  } else if (composition.form !== "none") {
    return false;
  }

  if (composition.hasTitle) {
    if (composition.titleLen === "none") {
      return false;
    }
  } else if (composition.titleLen !== "none") {
    return false;
  }

  return true;
}

export function compositionId(composition: TeaserComposition): string {
  return [
    `span-${composition.span}`,
    composition.hasImage ? "img" : "noimg",
    composition.form,
    composition.hasTitle ? "title" : "notitle",
    composition.titleLen,
    `desc-${composition.desc}`,
    `extra-${composition.extra}`,
  ].join("__");
}

export function parseCompositionId(id: string): TeaserComposition {
  const parts = id.split("__");
  if (parts.length !== 7) {
    throw new Error(`invalid composition id segment count: ${id}`);
  }
  const [spanPart, imgPart, form, titlePart, titleLen, descPart, extraPart] =
    parts;

  if (!spanPart.startsWith("span-")) {
    throw new Error(`invalid composition id span: ${id}`);
  }
  if (!descPart.startsWith("desc-")) {
    throw new Error(`invalid composition id desc: ${id}`);
  }
  if (!extraPart.startsWith("extra-")) {
    throw new Error(`invalid composition id extra: ${id}`);
  }
  if (imgPart !== "img" && imgPart !== "noimg") {
    throw new Error(`invalid composition id image flag: ${id}`);
  }
  if (titlePart !== "title" && titlePart !== "notitle") {
    throw new Error(`invalid composition id title flag: ${id}`);
  }

  return {
    span: spanPart.slice("span-".length) as TeaserSpan,
    hasImage: imgPart === "img",
    form: form as ImageForm,
    hasTitle: titlePart === "title",
    titleLen: titleLen as TitleLen,
    desc: descPart.slice("desc-".length) as DescLen,
    extra: extraPart.slice("extra-".length) as ExtraFields,
  };
}

export function isAllowedComposition(composition: TeaserComposition): boolean {
  if (!isStructurallyValidComposition(composition)) {
    return false;
  }
  return !COMPOSITION_BLACKLIST.has(compositionId(composition));
}

export function listAllStructurallyValidCompositions(): TeaserComposition[] {
  const list: TeaserComposition[] = [];
  for (const span of SPANS) {
    for (const hasImage of [false, true]) {
      const forms: readonly ImageForm[] = hasImage ? IMAGE_FORMS : ["none"];
      for (const form of forms) {
        for (const hasTitle of [false, true]) {
          const titleLens: readonly TitleLen[] = hasTitle
            ? TITLE_LENS
            : ["none"];
          for (const titleLen of titleLens) {
            for (const desc of DESC_LENS) {
              for (const extra of EXTRAS) {
                const composition: TeaserComposition = {
                  span,
                  hasImage,
                  form,
                  hasTitle,
                  titleLen,
                  desc,
                  extra,
                };
                if (!isStructurallyValidComposition(composition)) {
                  throw new Error(
                    `generator produced invalid composition: ${compositionId(composition)}`,
                  );
                }
                list.push(composition);
              }
            }
          }
        }
      }
    }
  }
  return list;
}

/** Blacklist is static — materialize once for pick/fit hot paths. */
const ALLOWED_COMPOSITIONS: readonly TeaserComposition[] =
  listAllStructurallyValidCompositions().filter(isAllowedComposition);

const ALLOWED_COMPOSITIONS_BY_SPAN: ReadonlyMap<
  TeaserSpan,
  readonly TeaserComposition[]
> = (() => {
  const map = new Map<TeaserSpan, TeaserComposition[]>();
  for (const span of SPANS) {
    map.set(span, []);
  }
  for (const composition of ALLOWED_COMPOSITIONS) {
    const bucket = map.get(composition.span);
    if (!bucket) {
      throw new Error(`unexpected span in allowed composition: ${composition.span}`);
    }
    bucket.push(composition);
  }
  return map;
})();

export function listAllowedCompositions(): readonly TeaserComposition[] {
  return ALLOWED_COMPOSITIONS;
}

export function listAllowedCompositionsForSpan(
  span: TeaserSpan,
): readonly TeaserComposition[] {
  return ALLOWED_COMPOSITIONS_BY_SPAN.get(span) ?? [];
}
