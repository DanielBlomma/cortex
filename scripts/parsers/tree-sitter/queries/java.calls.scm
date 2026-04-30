; Java call captures. method_invocation always has a `name` field of
; kind identifier — the trailing method name. Covers foo(),
; Helper.load(), obj.method(), System.out.println(...).

(method_invocation
  name: (identifier) @call.name)
