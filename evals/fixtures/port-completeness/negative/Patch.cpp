#include "Patch.hpp"

bool ApplyPatch(void* address) {
#if defined(_M_ARM64)
    return WriteBrk(address);
#else
    return WriteTrap(address);
#endif
}
