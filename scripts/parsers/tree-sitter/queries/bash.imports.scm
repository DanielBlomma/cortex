; Bash "imports" are source/. commands. Capture all commands — the
; adapter filters to command_name == "source" or "." and extracts
; the first static `word` argument as the sourced path.

(command) @import.cmd
