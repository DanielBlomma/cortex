; Java import captures. The import_declaration node wraps either a
; scoped_identifier (for the full path) or a scoped_identifier plus an
; asterisk (wildcard). The adapter extracts the path text and appends
; ".*" for wildcards.

(import_declaration) @import.decl
