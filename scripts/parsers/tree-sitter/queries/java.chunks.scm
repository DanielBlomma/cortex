; Java chunk captures.
; - class_declaration, interface_declaration, enum_declaration,
;   record_declaration — each has an identifier name.
; - method_declaration and constructor_declaration are nested in
;   class/interface bodies; the adapter walks up to qualify names.

(class_declaration
  name: (identifier) @class.name) @class.decl

(interface_declaration
  name: (identifier) @interface.name) @interface.decl

(enum_declaration
  name: (identifier) @enum.name) @enum.decl

(record_declaration
  name: (identifier) @record.name) @record.decl

(method_declaration
  name: (identifier) @method.name) @method.decl

(constructor_declaration
  name: (identifier) @ctor.name) @ctor.decl
