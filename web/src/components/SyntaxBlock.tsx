import "./SyntaxBlock.css";
import { useEffect, useState } from "react";
import { highlightCode, normalizeHighlightLanguage } from "../highlight";

interface Props {
  code: string;
  language?: string;
  caption?: string;
  colorMode?: "light" | "dark";
  showLineNumbers?: boolean;
}

export function SyntaxBlock({
  code,
  language,
  caption,
  colorMode,
  showLineNumbers = false,
}: Props) {
  const requestKey = `${language ?? ""}\u0000${code}`;
  const [result, setResult] = useState<{ key: string; html: string } | null>(null);

  useEffect(() => {
    let cancelled = false;

    void highlightCode(code, language).then(({ html }) => {
      if (!cancelled) setResult({ key: requestKey, html });
    });

    return () => {
      cancelled = true;
    };
  }, [code, language, requestKey]);

  const normalizedLanguage = normalizeHighlightLanguage(language);
  const label = formatLanguageLabel(language, normalizedLanguage);
  const html = result?.key === requestKey ? result.html : null;

  return (
    <figure
      className="syntax-block"
      data-color-mode={colorMode}
      data-lines={showLineNumbers ? "true" : "false"}
    >
      <figcaption className="syntax-block__head">
        <span className="syntax-block__lang">{label}</span>
        {caption && <span className="syntax-block__caption">{caption}</span>}
      </figcaption>
      <div className="syntax-block__body" aria-busy={html ? undefined : true}>
        {html ? (
          <div
            className="syntax-block__html"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <pre className="syntax-block__fallback">
            <code>{code}</code>
          </pre>
        )}
      </div>
    </figure>
  );
}

function formatLanguageLabel(input: string | undefined, normalized: string): string {
  const raw = input?.trim();
  return raw ? raw.toLowerCase() : normalized;
}
