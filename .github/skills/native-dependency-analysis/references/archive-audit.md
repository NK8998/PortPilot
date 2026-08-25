# Native archive audit

Classify each executable or library before deciding whether its machine type blocks the port.

| Class | Examples | ARM64 target requirement |
|---|---|---|
| Shipped runtime | DLL loaded by the product, helper EXE copied to package | Must be ARM64/ARM64EC/ARM64X or portable managed IL |
| Link input | `.lib` used by an ARM64 target | Must contain compatible ARM64 objects |
| Host build tool | `protoc.exe`, code generator, package manager | May match the build host; must not ship |
| Test-only target | Native test helper executed on ARM64 | Must be ARM64 |
| Documentation/data | templates, symbols, text, schemas | Not a PE architecture concern |

Inventory archive paths, sizes, and hashes. Then trace copy/link/load behavior. Folder names are
useful evidence but not a substitute for reading PE/COFF headers in the final staging tree.

Acquisition must pin a versioned URL and expected SHA-256 before extraction. Preserve the
downloaded package hash in the run evidence so a later agent can reproduce the dependency graph.

## A dependency shipped from the toolchain, not from a package feed

Not every shipped runtime comes from a manifest. OpenCppCoverage loads `msdia140.dll`, the Debug
Interface Access component, which is delivered by the Visual Studio DIA SDK rather than by NuGet or
vcpkg, so it appears in no lock file and a manifest-only audit misses it entirely. It must still be
found, classified as a shipped runtime, and shipped in the target architecture.

Read the toolchain layout directly:

```
DIA SDK\bin\arm64\msdia140.dll      <- ARM64 target payload, ships
DIA SDK\lib\arm64\diaguids.lib      <- ARM64 link input
DIA SDK\bin\msdia140.dll            <- x86 default, must not ship in an ARM64 package
DIA SDK\bin\amd64\msdia140.dll      <- x64, must not ship in an ARM64 package
```

The trap is that the default `bin\` path holds the x86 build with no architecture in its name, so a
copy step written for the original x86 port silently keeps shipping x86 after retargeting, and the
file name is identical in all three locations. Nothing but the PE header distinguishes them. The
same shape recurs for any SDK that puts the host default at the root and the cross builds in named
subdirectories.

Two generalisations worth carrying:

- Enumerate shipped runtime dependencies from what the product *loads*, not only from what a
  manifest *declares*. A component acquired from the compiler installation is still a dependency.
- Availability of an ARM64 payload inside the SDK is not evidence that the packaged one is ARM64.
  Confirm it in the final staging tree with a PE read, which is what `arm64-purity` is for.