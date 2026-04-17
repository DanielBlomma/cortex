; Bash calls. Every `command` node has a `command_name` which contains
; the program / function being invoked. The adapter filters out
; builtins and common system commands so the graph reflects user-
; defined function calls rather than shell plumbing.

(command
  name: (command_name) @call.name)
