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
// php-wasm. Drives the cs-09 fixture (lib/format.php), seeds the user's
// example into a diff line, opens the runner panel, types `2` for `$a`,
// clicks Run, and captures the output frame.

export default storyboard({
  name: "coderunner-php",
  url: "http://localhost:5199/?cs=cs-09",
  output: "docs/coderunner-php.gif",
  steps: [
    waitFor(".diff"),
    press("Escape", { hold: 300 }),
    shot("php_diff", 0.6),

    // Seed a self-contained PHP closure into the first diff line and
    // select it. The runner picks up the selection and floats the pill.
    setSelection(".diff .line .line__text", "function ($a) { echo $a; }"),
    wait(250),
    waitFor(".coderunner__pill"),
    shot("pill_visible", 1.0),

    // Open the panel.
    click(".coderunner__pill", { hold: 250 }),
    waitFor(".coderunner__panel"),
    shot("panel_open", 0.8),

    // Bind $a = 2.
    type(".coderunner__input-box", "2", { hold: 250 }),
    shot("input_filled", 0.7),

    // Run — first PHP run loads the WASM runtime, which can take a moment.
    click(".coderunner__run"),
    waitFor(".coderunner__out"),
    wait(400),
    shot("php_output", 1.6),
  ],
});
