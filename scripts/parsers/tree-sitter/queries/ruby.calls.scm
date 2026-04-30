; Ruby call captures. Every call node in tree-sitter-ruby has a
; `method` field of kind identifier — the method name regardless of
; whether there's a receiver (foo(), obj.bar, Class.baz(...)).

(call
  method: (identifier) @call.name)
