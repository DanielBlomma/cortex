; Python call captures. The `call` node's `function` field may be:
;   - identifier: direct call like foo()
;   - attribute: method/qualified call like obj.method() or pkg.fn()
;   - subscript: rare dynamic indexing — intentionally skipped.

(call
  function: (identifier) @call.name)

(call
  function: (attribute
    attribute: (identifier) @call.name))
