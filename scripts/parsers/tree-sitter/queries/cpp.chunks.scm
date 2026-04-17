; C/C++ chunk captures. tree-sitter-cpp parses C too (superset), so
; one grammar covers .c, .h, .cpp, .cc, .hpp, .hh.
;
; - function_definition: top-level functions, methods defined inline
;   inside class bodies, and out-of-class method definitions (with
;   qualified_identifier like `Foo::bar`). The adapter inspects the
;   function_declarator to pick the name form.
; - class_specifier / struct_specifier / union_specifier: type decls.
; - enum_specifier: plain `enum` and `enum class`.
; - namespace_definition: named namespaces (including nested `a::b`).
; - template_declaration is NOT captured directly — the inner
;   class/function is captured separately, and walking up to the
;   template_declaration parent for start-line is handled in the
;   adapter if needed.

(function_definition) @fn.decl

(class_specifier
  name: (type_identifier) @class.name) @class.decl

(struct_specifier
  name: (type_identifier) @struct.name) @struct.decl

(union_specifier
  name: (type_identifier) @union.name) @union.decl

(enum_specifier
  name: (type_identifier) @enum.name) @enum.decl

(namespace_definition) @namespace.decl
