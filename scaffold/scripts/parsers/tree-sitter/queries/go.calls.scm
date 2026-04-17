; Go call-expression captures. Function field can be:
;   - identifier: direct call like foo()
;   - selector_expression: qualified call like pkg.Fn() or obj.Method()
; The adapter extracts the trailing identifier (the "name" of the call).

(call_expression
  function: (identifier) @call.name)

(call_expression
  function: (selector_expression
    field: (field_identifier) @call.name))
