import {
  storyboard,
  wait,
  waitFor,
  press,
  shot,
  click,
  type,
  setSelection,
} from "../demo-lib.mjs";

// Demonstrates the inline CodeRunner running real PHP in the browser via
// php-wasm. Drives the cs-09 fixture (lib/money.php), seeds a recognizable
// format_money() helper into a diff line, opens the runner panel, types a
// $cents value, runs it, and captures the formatted-money output. Then a
// second snappy run to show that subsequent runs are instant once the WASM
// runtime is cached.

export default storyboard({
  name: "coderunner-php",
  url: "http://localhost:5199/?cs=cs-09",
  output: "docs/coderunner-php.gif",
  steps: [
    // 1. Land on the changeset, dismiss the plan overlay so the diff shows.
    waitFor(".diff"),
    press("Escape", { hold: 350 }),
    waitFor(".diff .line .line__text"),
    shot("php_diff", 1.4),

    // 2. Seed a self-contained PHP function into the first diff line and
    //    select it. The runner picks up the selection and floats the pill.
    setSelection(
      ".diff .line .line__text",
      "function format_money($cents) { return '$' . number_format($cents / 100, 2); }",
    ),
    wait(250),
    waitFor(".coderunner__pill"),
    shot("pill_visible", 1.4),

    // 3. Open the panel — empty input slot for $cents.
    click(".coderunner__pill", { hold: 300 }),
    waitFor(".coderunner__panel"),
    shot("panel_open", 1.0),

    // 4. Bind $cents = 1234.
    type(".coderunner__input-box", "1234", { hold: 350 }),
    shot("input_filled", 1.0),

    // 5. Run — first PHP run downloads ~21MB of WASM (1.5–4s), so wait
    //    generously for the output to appear.
    click(".coderunner__run"),
    waitFor(".coderunner__out", { timeout: 10000 }),
    wait(400),
    shot("php_output", 2.2),

    // 6. Second run with a different value — WASM is warm now, instant.
    type(".coderunner__input-box", "9950", { hold: 300 }),
    click(".coderunner__run"),
    wait(450),
    shot("php_output_2", 2.0),
  ],
});
