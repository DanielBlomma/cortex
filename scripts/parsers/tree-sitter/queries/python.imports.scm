; Python import captures. Covers three forms:
;   import foo
;   import foo as bar
;   from pkg import name
;   from .pkg import name
;   from pkg import name as alias
;
; The adapter renders each as a dot-separated fully-qualified string
; matching what a user would grep for ("pkg.name", "foo", ".pkg.name").

(import_statement) @import.stmt

(import_from_statement) @import.stmt
