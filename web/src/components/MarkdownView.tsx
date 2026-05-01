import "./MarkdownView.css";
import githubMarkdownLightCss from "github-markdown-css/github-markdown-light.css?raw";
import githubMarkdownDarkCss from "github-markdown-css/github-markdown-dark.css?raw";
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkAlert } from "remark-github-blockquote-alert";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import { highlightCode } from "../highlight";

// Inject scoped GitHub markdown styles once on first import. The standalone
// -light/-dark stylesheets target `.markdown-body`; rescope each under
// `[data-color-scheme=…] .markdown-body` so the variant follows the app's
// theme. `data-color-scheme` lives on <html> and is kept up-to-date by the
// global theme code, so swapping themes auto-toggles the preview without
// MarkdownView holding its own theme state.
if (typeof document !== "undefined" && !document.getElementById("gh-md-scoped")) {
  const style = document.createElement("style");
  style.id = "gh-md-scoped";
  const scope = (css: string, scheme: "light" | "dark") =>
    css.replace(/\.markdown-body/g, `[data-color-scheme="${scheme}"] .markdown-body`);
  style.textContent = `${scope(githubMarkdownLightCss, "light")}\n${scope(githubMarkdownDarkCss, "dark")}`;
  document.head.appendChild(style);
}

interface Props {
  /** Raw markdown source. */
  source: string;
  /**
   * Path of the file being rendered, used as the base for resolving relative
   * image and link references (e.g. `docs/features/prompt-results.md`).
   */
  basePath: string;
  /**
   * Map from repo-relative file path to a data URL (or any URL the browser
   * can load). MarkdownView resolves relative image references against this
   * map; references it cannot resolve render as broken images.
   */
  imageAssets?: Record<string, string>;
}

export function MarkdownView({ source, basePath, imageAssets }: Props) {
  const baseDir = useMemo(() => dirname(basePath), [basePath]);

  return (
    <section className="md-preview">
      <div className="markdown-body">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkAlert]}
          rehypePlugins={[
            rehypeSlug,
            [rehypeAutolinkHeadings, { behavior: "wrap" }],
          ]}
          components={{
            code: CodeBlock,
            img: (props) => <ResolvedImg {...props} baseDir={baseDir} imageAssets={imageAssets} />,
            a: (props) => <ResolvedLink {...props} baseDir={baseDir} />,
          }}
        >
          {source}
        </ReactMarkdown>
      </div>
    </section>
  );
}

function CodeBlock({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLElement>) {
  const text = String(children ?? "").replace(/\n$/, "");
  // react-markdown emits inline code as `code` without a `language-*` class.
  // Block code arrives as `<pre><code class="language-x">…</code></pre>`.
  const match = /language-([\w-]+)/.exec(className ?? "");

  if (!match) {
    return <code className={className} {...rest}>{children}</code>;
  }

  return <ShikiBlock code={text} language={match[1]} />;
}

function ShikiBlock({ code, language }: { code: string; language: string }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void highlightCode(code, language).then((result) => {
      if (!cancelled) setHtml(result.html);
    });
    return () => { cancelled = true; };
  }, [code, language]);

  if (html) {
    return (
      <span
        className="md-preview__shiki"
        // Shiki returns a complete <pre><code>…</code></pre> tree.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  return (
    <pre className="md-preview__code-fallback">
      <code>{code}</code>
    </pre>
  );
}

function ResolvedImg({
  src,
  alt,
  baseDir,
  imageAssets,
  ...rest
}: React.ImgHTMLAttributes<HTMLImageElement> & {
  baseDir: string;
  imageAssets?: Record<string, string>;
}) {
  const resolved = resolveImageSrc(src, baseDir, imageAssets);
  return <img src={resolved} alt={alt ?? ""} {...rest} />;
}

function ResolvedLink({
  href,
  children,
  baseDir,
  ...rest
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { baseDir: string }) {
  const isAbsolute = href ? /^(?:[a-z]+:|\/\/|#)/i.test(href) : false;
  if (!href || isAbsolute) {
    return <a href={href} {...rest}>{children}</a>;
  }
  // Relative link inside the repo. We don't have anywhere to navigate to, so
  // surface the resolved repo path as a tooltip and disable the link.
  const resolved = resolvePath(baseDir, href);
  return (
    <a
      href={`#${resolved}`}
      title={resolved}
      onClick={(e) => e.preventDefault()}
      {...rest}
    >
      {children}
    </a>
  );
}

function resolveImageSrc(
  src: string | undefined,
  baseDir: string,
  imageAssets: Record<string, string> | undefined,
): string | undefined {
  if (!src) return undefined;
  if (/^(?:[a-z]+:|\/\/|data:)/i.test(src)) return src;
  if (!imageAssets) return src;
  const resolved = resolvePath(baseDir, src);
  return imageAssets[resolved] ?? src;
}

function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

function resolvePath(baseDir: string, rel: string): string {
  // Strip a leading "./".
  const stripped = rel.startsWith("./") ? rel.slice(2) : rel;
  if (stripped.startsWith("/")) return stripped.slice(1);

  const baseParts = baseDir ? baseDir.split("/").filter(Boolean) : [];
  const relParts = stripped.split("/");
  for (const part of relParts) {
    if (part === "..") baseParts.pop();
    else if (part !== "." && part !== "") baseParts.push(part);
  }
  return baseParts.join("/");
}
