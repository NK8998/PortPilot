#include "Patch.hpp"

bool ApplyPatch(void* address) {
#if defined(_M_ARM64)
    // TODO: ARM64 support
    return false;
#else
    return WriteTrap(address);
#endif
}
