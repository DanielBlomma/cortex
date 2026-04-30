; Ruby chunk captures.
; - class / module: top-level or nested type-like declarations
; - method: regular `def name` inside a class/module (or top-level)
; - singleton_method: `def self.name` — class-level methods

(class
  name: (constant) @class.name) @class.decl

(module
  name: (constant) @module.name) @module.decl

(method
  name: (identifier) @method.name) @method.decl

(singleton_method
  name: (identifier) @singleton.name) @singleton.decl
