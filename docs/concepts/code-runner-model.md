# Code Runner Model

## What it is
The abstraction that turns selected code into something runnable in-browser.

## What it does
- Detects language from file path.
- Classifies a selection as an anonymous function, named function, or free code.
- Extracts input slots from parameters or free variables.
- Gives the UI enough shape information to offer guided inputs instead of a raw text box every time.
