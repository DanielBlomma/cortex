; C/C++ include directives. `#include <x>` uses system_lib_string
; (the path includes the angle brackets); `#include "x"` uses
; string_literal. The adapter normalizes both to the bare path
; (without angle brackets or quotes).

(preproc_include) @include.decl
