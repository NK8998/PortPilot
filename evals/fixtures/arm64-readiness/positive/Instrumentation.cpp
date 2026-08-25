#include <windows.h>
#include <emmintrin.h>

#if defined(_M_X64)
static const unsigned char kTrap = 0xCC;
#endif

static int Checksum(const float* values) {
    __m128 block = _mm_loadu_ps(values);
    int result = 0;
    __asm { mov eax, 1 }
    return result + block.m128_i32[0];
}

bool SetBreakpoint(HANDLE process, void* address) {
    SIZE_T written = 0;
    return WriteProcessMemory(process, address, &kTrap, 1, &written) != FALSE;
}
