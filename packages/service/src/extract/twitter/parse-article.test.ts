import { describe, expect, it } from "vitest";
import {
  buildArticleMarkdownFromPayload,
  extractArticleEmbeddedMedia,
  parseArticleFromHtml,
} from "./parse-article.js";

const FIXTURE_MEDIA_ENTITIES = [
  'media_entities:$R[100]=[$R[101]={media_id:"111",media_info:$R[102]={__typename:"ApiImage",alt_text:null,original_img_url:"https://pbs.twimg.com/media/IMG-A.jpg",original_img_width:1,original_img_height:1}},$R[103]={media_id:"222",media_info:$R[104]={__typename:"ApiVideo",preview_image:$R[105]={alt_text:null,original_img_url:"https://pbs.twimg.com/amplify_video_thumb/222/img/x.jpg"},variants:$R[106]=[$R[107]={bit_rate:832000,content_type:"video/mp4",url:"https://video.twimg.com/amplify_video/222/vid/avc1/500x360/a.mp4"},$R[108]={bit_rate:2176000,content_type:"video/mp4",url:"https://video.twimg.com/amplify_video/222/vid/avc1/1000x720/b.mp4"}]}}]',
].join("\n");

const FIXTURE_BLOCKS_AND_ENTITIES = [
  'blocks:$R[1]=[$R[2]={key:"a",text:"Intro with os.agno.com mention",type:"unstyled",data:$R[3]={},entity_ranges:$R[4]=[]},$R[5]={key:"b",text:" ",type:"atomic",data:$R[6]={},entity_ranges:$R[7]=[$R[8]={key:0,length:1,offset:0}]},$R[9]={key:"c",text:" ",type:"atomic",data:$R[10]={},entity_ranges:$R[11]=[$R[12]={key:1,length:1,offset:0}]},$R[13]={key:"d",text:"Make sure docker is installed.",type:"ordered-list-item",data:$R[14]={},entity_ranges:$R[15]=[$R[16]={key:2,length:6,offset:10}]},$R[17]={key:"e",text:"Section",type:"header-two",data:$R[18]={},entity_ranges:$R[19]=[]}]',
  'entity_map:$R[20]=[$R[21]={key:"0",value:$R[22]={type:"MEDIA",data:$R[23]={caption:null,markdown:null,media_items:$R[24]=[$R[25]={media_id:"111"}],tweet_id:null,url:null}}},$R[26]={key:"1",value:$R[27]={type:"MEDIA",data:$R[28]={caption:null,markdown:null,media_items:$R[29]=[$R[30]={media_id:"222"}],tweet_id:null,url:null}}},$R[31]={key:"2",value:$R[32]={type:"LINK",data:$R[33]={url:"https://www.docker.com/products/docker-desktop/",text:null}}},$R[34]={key:"3",value:$R[35]={type:"LINK",data:$R[36]={url:"https://os.agno.com/",text:null}}}]',
  FIXTURE_MEDIA_ENTITIES,
].join("\n");

describe("extractArticleEmbeddedMedia (#954)", () => {
  it("never uses og:image and collects ApiImage + best ApiVideo mp4", () => {
    const html = [
      '<meta property="og:image" content="https://pbs.twimg.com/media/MUST-NOT-USE-OG.jpg" />',
      FIXTURE_MEDIA_ENTITIES,
    ].join("\n");
    const media = extractArticleEmbeddedMedia(html);
    expect(media.map((m) => m.url)).toEqual([
      "https://pbs.twimg.com/media/IMG-A.jpg",
      "https://video.twimg.com/amplify_video/222/vid/avc1/1000x720/b.mp4",
    ]);
    expect(media.every((m) => !m.url.includes("MUST-NOT-USE-OG"))).toBe(true);
  });

  it("orders media by atomic blocks when present", () => {
    const media = extractArticleEmbeddedMedia(FIXTURE_BLOCKS_AND_ENTITIES);
    expect(media.map((m) => m.url)).toEqual([
      "https://pbs.twimg.com/media/IMG-A.jpg",
      "https://video.twimg.com/amplify_video/222/vid/avc1/1000x720/b.mp4",
    ]);
  });
});

describe("buildArticleMarkdownFromPayload (#954)", () => {
  it("applies LINK entity ranges by offset and linkifies bare hosts", () => {
    const md = buildArticleMarkdownFromPayload(FIXTURE_BLOCKS_AND_ENTITIES);
    expect(md).toContain("![](https://pbs.twimg.com/media/IMG-A.jpg)");
    expect(md).toContain(
      "![](https://video.twimg.com/amplify_video/222/vid/avc1/1000x720/b.mp4)",
    );
    expect(md).toContain("## Section");
    expect(md).toContain(
      "1. Make sure [docker](https://www.docker.com/products/docker-desktop/) is installed.",
    );
    expect(md).toContain("[os.agno.com](https://os.agno.com/)");
    expect(md).not.toMatch(/\]\(https:\/\/www\.\[/);
  });

  it("parses blocks whose data nests urls arrays", () => {
    const html = [
      'blocks:$R[1]=[$R[2]={key:"a",text:"Get your prompt from os.agno.com today.",type:"ordered-list-item",data:$R[3]={cashtags:null,hashtags:null,mentions:null,urls:$R[4]=[$R[5]={from_index:22,to_index:33,url:"https://os.agno.com/"}]},entity_ranges:$R[6]=[]}]',
      'entity_map:$R[10]=[$R[11]={key:"3",value:$R[12]={type:"LINK",data:$R[13]={url:"https://os.agno.com/",text:null}}}]',
    ].join("\n");
    const md = buildArticleMarkdownFromPayload(html);
    expect(md).toContain(
      "1. Get your prompt from [os.agno.com](https://os.agno.com/) today.",
    );
  });
});

describe("parseArticleFromHtml (#954)", () => {
  it("ignores og:image even when it is the only meta image", () => {
    const html = [
      '<meta property="og:title" content="Only og" />',
      '<meta property="og:description" content="Teaser text for the article body fallback." />',
      '<meta property="og:image" content="https://pbs.twimg.com/media/MUST-NOT-USE-OG.jpg" />',
    ].join("\n");
    const parsed = parseArticleFromHtml(html, "Art1", "user");
    expect(parsed).not.toBeNull();
    expect(parsed!.media).toEqual([]);
  });

  it("collects pbs media from HTML fallback body when DraftJS entities are absent", () => {
    const html = [
      "<article>",
      "<p>Intro</p>",
      '<img src="https://pbs.twimg.com/media/FALLBACK-ONLY.jpg" />',
      "</article>",
    ].join("\n");
    const parsed = parseArticleFromHtml(html, "ArtFb", "user");
    expect(parsed).not.toBeNull();
    expect(parsed!.text).toContain(
      "![](https://pbs.twimg.com/media/FALLBACK-ONLY.jpg)",
    );
    expect(parsed!.media.map((m) => m.url)).toEqual([
      "https://pbs.twimg.com/media/FALLBACK-ONLY.jpg",
    ]);
  });

  it("returns markdown body with links and media from DraftJS payload", () => {
    const html = [
      '<meta property="og:title" content="How to improve" />',
      '<meta property="og:image" content="https://pbs.twimg.com/media/MUST-NOT-USE-OG.jpg" />',
      FIXTURE_BLOCKS_AND_ENTITIES,
    ].join("\n");
    const parsed = parseArticleFromHtml(html, "2084301728363462919", "ashpreetbedi");
    expect(parsed).not.toBeNull();
    expect(parsed!.text).toContain("![](https://pbs.twimg.com/media/IMG-A.jpg)");
    expect(parsed!.text).toContain(
      "[docker](https://www.docker.com/products/docker-desktop/)",
    );
    expect(parsed!.media).toHaveLength(2);
    expect(parsed!.media.every((m) => !m.url.includes("MUST-NOT-USE-OG"))).toBe(
      true,
    );
  });
});
