import "./SyntaxBlock.css";
import { useEffect, useState, type ReactNode } from "react";
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
  const [result, setResult] = useState<{ key: string; node: ReactNode } | null>(null);

  useEffect(() => {
    let cancelled = false;

    void highlightCode(code, language, colorMode).then(({ node }) => {
      if (!cancelled) setResult({ key: requestKey, node });
    });

    return () => {
      cancelled = true;
    };
  }, [code, language, colorMode, requestKey]);

  const normalizedLanguage = normalizeHighlightLanguage(language);
  const label = formatLanguageLabel(language, normalizedLanguage);
  const node = result?.key === requestKey ? result.node : null;

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
      <div className="syntax-block__body" aria-busy={node ? undefined : true}>
        {node ? (
          <div className="syntax-block__html">{node}</div>
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
