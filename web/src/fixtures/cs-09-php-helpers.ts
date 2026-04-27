import type { ChangeSet, Reply } from "../types";

// Tiny PHP-flavored fixture used to demo the CodeRunner prototype on a `.php`
// file. The runner picks the language from the file path; selecting code in
// any of these lines should pop the run-with-inputs panel.
export const CS_09: ChangeSet = {
  id: "cs-09",
  title: "Add small PHP helpers",
  author: "romina",
  branch: "feat/php-helpers",
  base: "main",
  createdAt: "2026-04-23T09:00:00Z",
  description: "Adds a couple of small PHP helpers — useful for trying the inline runner.",
  skills: [
    {
      id: "php-basics",
      label: "review PHP basics",
      reason: "small set of helpers in lib/format.php",
    },
  ],
  files: [
    {
      id: "cs-09/lib/format.php",
      path: "lib/format.php",
      language: "php",
      status: "added",
      hunks: [
        {
          id: "cs-09/lib/format.php#h1",
          header: "@@ -0,0 +1,12 @@",
          oldStart: 0,
          oldCount: 0,
          newStart: 1,
          newCount: 12,
          definesSymbols: ["echoVal", "greet", "double"],
          lines: [
            { kind: "add", text: "<?php", newNo: 1 },
            { kind: "add", text: "", newNo: 2 },
            { kind: "add", text: "$echoVal = function ($a) { echo $a; };", newNo: 3 },
            { kind: "add", text: "", newNo: 4 },
            { kind: "add", text: "function greet($name) {", newNo: 5 },
            { kind: "add", text: "  return \"hello, $name!\";", newNo: 6 },
            { kind: "add", text: "}", newNo: 7 },
            { kind: "add", text: "", newNo: 8 },
            { kind: "add", text: "function double($x) {", newNo: 9 },
            { kind: "add", text: "  return $x * 2;", newNo: 10 },
            { kind: "add", text: "}", newNo: 11 },
            { kind: "add", text: "", newNo: 12 },
          ],
        },
      ],
    },
  ],
};

export const REPLIES_09: Record<string, Reply[]> = {};
