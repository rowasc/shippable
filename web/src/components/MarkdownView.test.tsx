import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownView } from "./MarkdownView";
import { resolveImageSrc } from "./resolveImageSrc";

describe("resolveImageSrc", () => {
  it("auto-loads repo-local images that resolve through imageAssets", () => {
    expect(
      resolveImageSrc("./images/diagram.png", "docs/guides", {
        "docs/guides/images/diagram.png": "data:image/png;base64,LOCAL",
      }),
    ).toEqual({
      kind: "local",
      resolvedPath: "docs/guides/images/diagram.png",
      src: "data:image/png;base64,LOCAL",
    });
  });

  it("blocks absolute and inline image sources by default", () => {
    expect(resolveImageSrc("https://tracker.example/pixel.png", "docs", {})).toEqual({
      kind: "blocked",
      src: "https://tracker.example/pixel.png",
    });
    expect(resolveImageSrc("//tracker.example/pixel.png", "docs", {})).toEqual({
      kind: "blocked",
      src: "//tracker.example/pixel.png",
    });
    expect(resolveImageSrc("data:image/png;base64,AAAA", "docs", {})).toEqual({
      kind: "blocked",
      src: "data:image/png;base64,AAAA",
    });
  });

  it("does not auto-load unresolved relative paths", () => {
    expect(resolveImageSrc("../images/missing.png", "docs/guides", {})).toEqual({
      kind: "unavailable",
      resolvedPath: "docs/images/missing.png",
      src: "../images/missing.png",
    });
  });
});

describe("MarkdownView image rendering", () => {
  it("renders local repo images as img tags", () => {
    const html = renderToStaticMarkup(
      <MarkdownView
        source="![Architecture](./images/diagram.png)"
        basePath="docs/guides/preview.md"
        imageAssets={{ "docs/guides/images/diagram.png": "data:image/png;base64,LOCAL" }}
      />,
    );

    expect(html).toContain('<img src="data:image/png;base64,LOCAL"');
    expect(html).toContain('alt="Architecture"');
    expect(html).not.toContain("Load image");
  });

  it("renders blocked placeholders for remote images before user opt-in", () => {
    const html = renderToStaticMarkup(
      <MarkdownView
        source="![Tracker](https://tracker.example/pixel.png)"
        basePath="docs/guides/preview.md"
        imageAssets={{}}
      />,
    );

    expect(html).toContain("Image blocked");
    expect(html).toContain("Load image");
    expect(html).toContain("https://tracker.example/pixel.png");
    expect(html).not.toContain("<img");
  });

  it("renders unavailable placeholders for relative images missing from imageAssets", () => {
    const html = renderToStaticMarkup(
      <MarkdownView
        source="![Missing](./images/missing.png)"
        basePath="docs/guides/preview.md"
        imageAssets={{}}
      />,
    );

    expect(html).toContain("Repo image unavailable");
    expect(html).toContain("docs/guides/images/missing.png");
    expect(html).not.toContain("Load image");
    expect(html).not.toContain("<img");
  });
});
