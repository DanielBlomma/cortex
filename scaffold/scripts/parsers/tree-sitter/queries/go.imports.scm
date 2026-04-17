; Go import captures. import_spec covers both single imports and
; entries inside grouped import_spec_list. The adapter unquotes the
; path string literal so "fmt" -> fmt, "github.com/foo/bar" -> github.com/foo/bar.

(import_spec
  path: (interpreted_string_literal) @import.path)
