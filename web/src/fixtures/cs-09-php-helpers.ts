import type { ChangeSet, Reply } from "../types";
import { lineNoteReplyKey } from "../types";

// PHP-flavored fixture. Doubles as a place to try the inline CodeRunner —
// every named/anon function below should pop the run-with-inputs panel when
// selected.
export const CS_09: ChangeSet = {
  id: "cs-09",
  title: "Add money formatting helpers",
  author: "marco",
  branch: "feat/money-helpers",
  base: "main",
  createdAt: "2026-04-23T09:00:00Z",
  description:
    "New `lib/money.php` with format/parse/add helpers backed by a tiny locale table. Replaces ad-hoc number_format() calls scattered across the cart.",
  files: [
    // ─── lib/money.php (new file) ────────────────────────────────────────
    {
      id: "cs-09/lib/money.php",
      path: "lib/money.php",
      language: "php",
      status: "added",
      hunks: [
        {
          id: "cs-09/lib/money.php#h1",
          header: "@@ -0,0 +1,18 @@",
          oldStart: 0,
          oldCount: 0,
          newStart: 1,
          newCount: 18,
          definesSymbols: ["format_money", "currency_symbol"],
          aiReviewed: true,
          aiSummary:
            "format_money divides cents by 100 then number_format()s — fine for USD/EUR but wrong for zero-decimal currencies (JPY, KRW). Consider a per-currency precision table.",
          lines: [
            { kind: "add", text: "<?php", newNo: 1 },
            { kind: "add", text: "// Money helpers used by the cart and the order summary.", newNo: 2 },
            { kind: "add", text: "// Amounts are stored as integer cents to avoid float drift.", newNo: 3 },
            { kind: "add", text: "", newNo: 4 },
            {
              kind: "add",
              text: "function format_money($cents, $currency = 'USD') {",
              newNo: 5,
              aiNote: {
                severity: "warning",
                summary: "JPY/KRW have no minor unit",
                detail:
                  "Hard-coding /100 means 1234 JPY would render as ¥12.34. Move the divisor into the currency table.",
                // The runner sandbox doesn't see other files in the diff,
                // so the recipe inlines `currency_symbol` alongside
                // `format_money` and ends with an `echo` so stdout shows
                // the actual rendered string. Inputs match the AI's
                // claim: 1234 cents in JPY should *not* divide by 100.
                runRecipe: {
                  source: [
                    "function currency_symbol($code) {",
                    "  $table = ['USD' => '$', 'EUR' => '€', 'GBP' => '£', 'JPY' => '¥'];",
                    "  return $table[$code] ?? $code . ' ';",
                    "}",
                    "",
                    "function format_money($cents, $currency = 'USD') {",
                    "  $sym = currency_symbol($currency);",
                    "  $amount = number_format($cents / 100, 2);",
                    "  return $sym . $amount;",
                    "}",
                    "",
                    "echo format_money($cents, $currency);",
                  ].join("\n"),
                  inputs: { cents: "1234", currency: "JPY" },
                },
              },
            },
            { kind: "add", text: "  $sym = currency_symbol($currency);", newNo: 6 },
            { kind: "add", text: "  $amount = number_format($cents / 100, 2);", newNo: 7 },
            { kind: "add", text: "  return $sym . $amount;", newNo: 8 },
            { kind: "add", text: "}", newNo: 9 },
            { kind: "add", text: "", newNo: 10 },
            { kind: "add", text: "function currency_symbol($code) {", newNo: 11 },
            { kind: "add", text: "  $table = ['USD' => '$', 'EUR' => '€', 'GBP' => '£', 'JPY' => '¥'];", newNo: 12 },
            { kind: "add", text: "  return $table[$code] ?? $code . ' ';", newNo: 13 },
            { kind: "add", text: "}", newNo: 14 },
            { kind: "add", text: "", newNo: 15 },
            { kind: "add", text: "function add_money($a_cents, $b_cents) {", newNo: 16 },
            { kind: "add", text: "  return $a_cents + $b_cents;", newNo: 17 },
            { kind: "add", text: "}", newNo: 18 },
          ],
        },
        {
          id: "cs-09/lib/money.php#h2",
          header: "@@ -0,0 +20,12 @@",
          oldStart: 0,
          oldCount: 0,
          newStart: 20,
          newCount: 12,
          definesSymbols: ["parse_money"],
          referencesSymbols: ["currency_symbol"],
          aiReviewed: true,
          aiSummary:
            "parse_money is regex-based and case-sensitive on the symbol. Any input that doesn't match returns null — callers need to handle that or this becomes a NPE waiting to happen.",
          expandAbove: [
            [
              { kind: "context", text: "function add_money($a_cents, $b_cents) {", oldNo: 16, newNo: 16 },
              { kind: "context", text: "  return $a_cents + $b_cents;", oldNo: 17, newNo: 17 },
              { kind: "context", text: "}", oldNo: 18, newNo: 18 },
              { kind: "context", text: "", oldNo: 19, newNo: 19 },
            ],
          ],
          lines: [
            {
              kind: "add",
              text: "// Best-effort parser. Accepts \"$12.34\", \"€12.34\", \"12.34\".",
              newNo: 20,
            },
            { kind: "add", text: "function parse_money($str) {", newNo: 21 },
            { kind: "add", text: "  $str = trim($str);", newNo: 22 },
            {
              kind: "add",
              text: "  if (preg_match('/^([\\$€£¥])?\\s*(\\d+)(?:\\.(\\d{1,2}))?$/u', $str, $m)) {",
              newNo: 23,
              aiNote: {
                severity: "question",
                summary: "Locale-sensitive separators?",
                detail:
                  "Many users will type comma decimals (e.g. \"12,34\"). Worth deciding whether parse_money should accept them or stay strict.",
              },
            },
            { kind: "add", text: "    $whole = (int)$m[2];", newNo: 24 },
            { kind: "add", text: "    $frac = isset($m[3]) ? (int)str_pad($m[3], 2, '0') : 0;", newNo: 25 },
            { kind: "add", text: "    return ['cents' => $whole * 100 + $frac, 'symbol' => $m[1] ?? null];", newNo: 26 },
            { kind: "add", text: "  }", newNo: 27 },
            { kind: "add", text: "  return null;", newNo: 28 },
            { kind: "add", text: "}", newNo: 29 },
            { kind: "add", text: "", newNo: 30 },
          ],
        },
      ],
    },

    // ─── lib/locale.php (modified) ───────────────────────────────────────
    {
      id: "cs-09/lib/locale.php",
      path: "lib/locale.php",
      language: "php",
      status: "modified",
      hunks: [
        {
          id: "cs-09/lib/locale.php#h1",
          header: "@@ -3,6 +3,12 @@ function current_locale()",
          oldStart: 3,
          oldCount: 6,
          newStart: 3,
          newCount: 12,
          definesSymbols: ["currency_for_locale"],
          expandAbove: [
            [
              { kind: "context", text: "<?php", oldNo: 1, newNo: 1 },
              { kind: "context", text: "// Locale + currency resolution.", oldNo: 2, newNo: 2 },
            ],
          ],
          lines: [
            { kind: "context", text: "function current_locale() {", oldNo: 3, newNo: 3 },
            { kind: "context", text: "  return $_SERVER['HTTP_ACCEPT_LANGUAGE'] ?? 'en-US';", oldNo: 4, newNo: 4 },
            { kind: "context", text: "}", oldNo: 5, newNo: 5 },
            { kind: "context", text: "", oldNo: 6, newNo: 6 },
            { kind: "add", text: "function currency_for_locale($locale) {", newNo: 7 },
            { kind: "add", text: "  $map = ['en-US' => 'USD', 'en-GB' => 'GBP', 'de-DE' => 'EUR', 'ja-JP' => 'JPY'];", newNo: 8 },
            { kind: "add", text: "  $tag = explode(',', $locale)[0];", newNo: 9 },
            { kind: "add", text: "  return $map[$tag] ?? 'USD';", newNo: 10 },
            { kind: "add", text: "}", newNo: 11 },
            { kind: "add", text: "", newNo: 12 },
            { kind: "context", text: "function locale_supported($code) {", oldNo: 7, newNo: 13 },
            { kind: "context", text: "  return in_array($code, ['en-US', 'en-GB', 'de-DE', 'ja-JP'], true);", oldNo: 8, newNo: 14 },
          ],
        },
      ],
    },

    // ─── tests/money_examples.php (new file) ─────────────────────────────
    {
      id: "cs-09/tests/money_examples.php",
      path: "tests/money_examples.php",
      language: "php",
      status: "added",
      hunks: [
        {
          id: "cs-09/tests/money_examples.php#h1",
          header: "@@ -0,0 +1,11 @@",
          oldStart: 0,
          oldCount: 0,
          newStart: 1,
          newCount: 11,
          referencesSymbols: ["format_money", "parse_money", "currency_for_locale"],
          lines: [
            { kind: "add", text: "<?php", newNo: 1 },
            { kind: "add", text: "// Smoke examples — easier to eyeball than full PHPUnit while iterating.", newNo: 2 },
            { kind: "add", text: "require __DIR__ . '/../lib/money.php';", newNo: 3 },
            { kind: "add", text: "require __DIR__ . '/../lib/locale.php';", newNo: 4 },
            { kind: "add", text: "", newNo: 5 },
            { kind: "add", text: "echo format_money(1234) . \"\\n\";          // $12.34", newNo: 6 },
            { kind: "add", text: "echo format_money(1234, 'EUR') . \"\\n\";   // €12.34", newNo: 7 },
            { kind: "add", text: "echo format_money(1234, 'JPY') . \"\\n\";   // bug: prints ¥12.34", newNo: 8 },
            { kind: "add", text: "", newNo: 9 },
            { kind: "add", text: "var_export(parse_money('$19.99'));         // ['cents'=>1999,'symbol'=>'$']", newNo: 10 },
            { kind: "add", text: "var_export(parse_money('not money'));      // null", newNo: 11 },
          ],
        },
      ],
    },
  ],
};

export const REPLIES_09: Record<string, Reply[]> = {
  [lineNoteReplyKey("cs-09/lib/money.php#h1", 4)]: [
    {
      id: "r-09-1",
      author: "marco",
      body:
        "Good catch on JPY. I'll move the divisor into a {currency: precision} table next pass — leaving the warning for now since the cart only sells USD/EUR/GBP today.",
      createdAt: "2026-04-23T11:14:00Z",
    },
  ],
};
