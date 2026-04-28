import "./SyntaxShowcase.css";
import { SyntaxBlock } from "./SyntaxBlock";

export interface SyntaxShowcaseSnippet {
  title: string;
  language: string;
  code: string;
}

interface Props {
  snippets: SyntaxShowcaseSnippet[];
}

export function SyntaxShowcase({ snippets }: Props) {
  return (
    <section className="syntax-showcase">
      <header className="syntax-showcase__head">
        <div className="syntax-showcase__title">Shiki preview</div>
        <div className="syntax-showcase__meta">
          GitHub light and dark themes across the languages we care about now
        </div>
      </header>
      <div className="syntax-showcase__modes">
        <PreviewColumn mode="light" snippets={snippets} />
        <PreviewColumn mode="dark" snippets={snippets} />
      </div>
    </section>
  );
}

function PreviewColumn({
  mode,
  snippets,
}: {
  mode: "light" | "dark";
  snippets: SyntaxShowcaseSnippet[];
}) {
  return (
    <section className={`syntax-showcase__col syntax-showcase__col--${mode}`}>
      <header className="syntax-showcase__mode">{mode} mode</header>
      <div className="syntax-showcase__stack">
        {snippets.map((snippet) => (
          <div key={`${mode}-${snippet.title}`} className="syntax-showcase__card">
            <div className="syntax-showcase__card-title">{snippet.title}</div>
            <SyntaxBlock
              code={snippet.code}
              language={snippet.language}
              colorMode={mode}
              showLineNumbers
            />
          </div>
        ))}
      </div>
    </section>
  );
}
