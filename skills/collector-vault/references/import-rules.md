# Import rules

## Channel

Ordinary link → note body is **agent fetch + `update-item` / `collector_update_item`**. Do not route that through extract discover/extract tools; those are host-specific plugins (e.g. Instagram), not this workflow.

## Goal

Import must preserve the article's function, not just its text.

If the source is a catalog, index, or navigation-rich article, the imported note must keep the useful links and structure in a working form. Cleaning markdown is not enough if the article stops being useful.

## Import invariants

- Put the canonical page link in the item `url` field, not as a `Source:` block at the top of the body.
- Body starts with the article content itself, not duplicate frontmatter, breadcrumbs, nav, share UI, subscribe prompts, related-post rails, comment UI, or footer chrome.
- Do not duplicate the article title at the top of `content` when the item already has a `title` field.
- Preserve useful links as working links. Do not delete them just because their current form is incompatible with the vault.
- Preserve the article's function, not just markdown cleanliness.

## Link handling

- Absolute web links (`http://...`, `https://...`) -> keep as web URLs.
- Relative source-page links (`foo`, `foo.md`, `/bar`, `../baz`) -> convert to absolute source-site URLs.
- Anchor links (`#section`) -> keep only if they are known to work in the target markdown renderer; otherwise keep the text without the link, or drop the TOC link block entirely.
- Vault-style / internal note links -> create only if the user explicitly asked for internal linking and targets can be mapped correctly.

## Local assets

When importing a page or article, bring related assets into local item media when they are fetchable and useful to the article.

Preferred order when one path fails:

1. shell download (`curl`, `wget`)
2. `WebFetch` to locate or retrieve the direct asset URL
3. inline `dataBase64` upload through media attach

A block on one path is not a reason to skip images entirely. Stop only after exhausting viable paths, and then report what was tried and what remains manual.

## Restore, do not delete

If a useful structure element is broken, the default action is to restore it in a working form, not to delete it.

Applies to:

- hyperlinks
- diagrams
- tables
- article TOCs
- section index lists

Deleting a useful structure element is acceptable only when it is truly source-site chrome or when there is no correct target representation.

## Done checklist

Before considering an import complete, verify:

- no duplicated title in `content`
- no duplicate frontmatter in body
- no source-site chrome at top or bottom
- no broken local `*.md` links unless the user explicitly asked for internal note linking
- no broken `#anchor` TOC links
- if the source article is a catalog/index, the imported note still contains working links
- if the source article had useful diagrams or images, they are preserved in a workable local form or explicitly reported as blocked after trying alternatives

## Anti-patterns

- deleting useful links instead of converting them to working source-site URLs
- rewriting source-page web links into local `(... .md)` links or vault-internal nodes without an explicit user request
- keeping a broken TOC full of `#anchor` links that do not work in the target renderer
- declaring import complete after `image count = 0` without exhausting viable download paths
- cleaning the page so aggressively that a catalog stops being a catalog
