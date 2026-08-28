#include <windows.h>

#if defined(_M_ARM64)
static const unsigned char kTrap[4] = { 0x00, 0x00, 0x20, 0xD4 };
#elif defined(_M_X64)
static const unsigned char kTrap[1] = { 0xCC };
#endif

bool SetBreakpoint(HANDLE process, void* address) {
    SIZE_T written = 0;
    return WriteProcessMemory(process, address, kTrap, sizeof(kTrap), &written) != FALSE;
}
