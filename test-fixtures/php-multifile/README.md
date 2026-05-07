# php-multifile fixture

Five sibling classes plus a `Routes.php` that instantiates each. Reproduces
the regression that `docs/plans/lsp-code-graph.md` exists to fix: with the
regex graph builder, `Routes.php` and its dependencies render as floating
islands because PHP `use` + `new` doesn't look like an ES import. With the
LSP graph builder, edges flow from each class file into `Routes.php`.

Used by `server/src/codeGraph.e2e.test.ts` and the manual UI smoke against
`/api/code-graph`. Tests copy these files into a fresh `git init`'d temp
directory so the endpoint's worktree validation accepts them.
