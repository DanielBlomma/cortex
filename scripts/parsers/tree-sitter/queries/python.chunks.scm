; Python chunk captures. function_definition covers both sync `def`
; and `async def` in tree-sitter-python (async is a token on the node,
; not a distinct node type). Decorated definitions wrap the inner
; function/class; we capture the inner nodes directly since startLine
; of the def/class is more useful than the decorator line.

(function_definition
  name: (identifier) @fn.name) @fn.decl

(class_definition
  name: (identifier) @class.name) @class.decl
