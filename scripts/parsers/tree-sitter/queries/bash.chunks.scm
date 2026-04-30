; Bash chunk captures. function_definition covers both
; `function foo { ... }` and `foo() { ... }` styles — the name lives
; in a `word` child.

(function_definition
  name: (word) @fn.name) @fn.decl
