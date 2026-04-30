; Go chunk captures.
; - function_declaration: top-level funcs
; - method_declaration: methods with receiver (adapter extracts receiver type)
; - type_declaration: wraps type_spec and type_alias — the adapter inspects
;   the body type (struct_type / interface_type / other) to choose the kind.

(function_declaration
  name: (identifier) @fn.name) @fn.decl

(method_declaration
  name: (field_identifier) @method.name) @method.decl

(type_declaration
  (type_spec
    name: (type_identifier) @type.name)) @type.decl

(type_declaration
  (type_alias
    name: (type_identifier) @type.name)) @type.decl
