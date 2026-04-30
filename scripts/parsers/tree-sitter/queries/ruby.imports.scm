; Ruby imports are function-style calls. Capture top-level calls
; whose method identifier is a loader function; the adapter filters
; to just require / require_relative / load / autoload and extracts
; the string-literal path argument.

(call
  method: (identifier) @import.func
  arguments: (argument_list)) @import.call
