; Call-expression captures for Rust. Extracts the callee identifier from
; call_expression nodes. The function field may be:
;   - identifier: direct call like foo()
;   - scoped_identifier: path call like std::fs::read()
;   - field_expression: method call like self.foo()
; The adapter resolves the trailing name for each form.

(call_expression
  function: (identifier) @call.name)

(call_expression
  function: (scoped_identifier
    name: (identifier) @call.name))

(call_expression
  function: (field_expression
    field: (field_identifier) @call.name))

(call_expression
  function: (generic_function
    function: (identifier) @call.name))

(call_expression
  function: (generic_function
    function: (scoped_identifier
      name: (identifier) @call.name)))

(call_expression
  function: (generic_function
    function: (field_expression
      field: (field_identifier) @call.name)))
