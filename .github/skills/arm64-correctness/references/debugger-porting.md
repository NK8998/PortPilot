# Windows ARM64 debugger correctness

## Breakpoints and program counter

x86/x64 software breakpoints commonly patch one byte (`INT3`, `0xCC`) and adjust EIP/RIP by one
when restoring execution. Windows ARM64 uses fixed-width instructions and architecture-specific
breakpoint encoding and exception semantics. Centralize:

- breakpoint byte sequence
- instruction width
- context program-counter getter/setter
- restore and single-step behavior
- instruction-cache synchronization after patching

Tests must prove original bytes are restored and execution resumes at the intended instruction.

## Context and PE handling

Do not cast all contexts to x64 fields. Select the correct Windows context structure and flags for
the target process. Extend PE/COFF parsing deliberately for `IMAGE_FILE_MACHINE_ARM64`; reject
unsupported machine types rather than routing them through x64 behavior.

## Runtime proof

Run a native ARM64 fixture that starts a target process, records coverage for known lines, and
produces non-empty expected output. Unit tests of helper functions are necessary but not
sufficient evidence that debugging works.
