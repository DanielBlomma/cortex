; Top-level item captures for Rust.
; Each @*.decl anchor wraps the whole item; companion captures expose
; the name or other fields used by the adapter.

(function_item
  name: (identifier) @fn.name
  body: (block)) @fn.decl

(struct_item
  name: (type_identifier) @struct.name) @struct.decl

(enum_item
  name: (type_identifier) @enum.name) @enum.decl

(trait_item
  name: (type_identifier) @trait.name) @trait.decl

(impl_item
  type: (type_identifier) @impl.type) @impl.decl

(impl_item
  type: (generic_type
    type: (type_identifier) @impl.type)) @impl.decl

(mod_item
  name: (identifier) @mod.name) @mod.decl

(macro_definition
  name: (identifier) @macro.name) @macro.decl
