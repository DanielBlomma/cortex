; C/C++ call captures.
; - Direct calls: `foo()` — identifier as function child.
; - Member calls: `obj.m()` / `ptr->m()` — field_expression with a
;   field_identifier; we capture the trailing field name.
; - Qualified calls: `ns::f()` / `Class::staticMethod()` —
;   qualified_identifier with a trailing name identifier.

(call_expression
  function: (identifier) @call.name)

(call_expression
  function: (field_expression
    field: (field_identifier) @call.name))

(call_expression
  function: (qualified_identifier
    name: (identifier) @call.name))
