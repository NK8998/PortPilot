#!/usr/bin/env bash
# qemu.sh - run Windows ARM64 WinPE under QEMU TCG for an S4 smoke test.
#
# This is a functional launch check, not native-hardware performance evidence.
#
# Required environment:
#   QEMU_ARM64_ISO          WSL path to a checksum-verified Windows ARM64 ISO
#   QEMU_ARM64_ISO_SHA256   publisher's SHA-256 for that ISO
#
# Optional environment:
#   QEMU_DIR                Windows QEMU install exposed to WSL
#                           (default: /mnt/c/Users/Public/qemu)
#   QEMU_VM_DIR             VM state directory
#                           (default: /mnt/c/Users/Public/qemu-vm)
#   QEMU_MONITOR_PORT       HMP monitor port (default: 4444)
#
# Usage:
#   ./scripts/qemu.sh check
#   ./scripts/qemu.sh prepare <arm64-exe> [smoke-args...]
#   ./scripts/qemu.sh boot             # keep this running; opens the QEMU window
#   ./scripts/qemu.sh boot-key         # from another shell after boot starts
#   ./scripts/qemu.sh attach           # only after Windows Setup appears
#   ./scripts/qemu.sh capture <output.ppm>
#   ./scripts/qemu.sh status
#   ./scripts/qemu.sh stop

set -euo pipefail

QEMU_DIR="${QEMU_DIR:-/mnt/c/Users/Public/qemu}"
QEMU_VM_DIR="${QEMU_VM_DIR:-/mnt/c/Users/Public/qemu-vm}"
QEMU_MONITOR_PORT="${QEMU_MONITOR_PORT:-4444}"
QEMU_ARM64_ISO="${QEMU_ARM64_ISO:-}"
QEMU_ARM64_ISO_SHA256="${QEMU_ARM64_ISO_SHA256:-}"

QEMU_SYSTEM="$QEMU_DIR/qemu-system-aarch64.exe"
QEMU_IMG="$QEMU_DIR/qemu-img.exe"
QEMU_CODE="$QEMU_DIR/share/edk2-aarch64-code.fd"
QEMU_VARS_TEMPLATE="$QEMU_DIR/share/edk2-arm-vars.fd"
QEMU_VARS="$QEMU_VM_DIR/edk2-arm-vars.fd"
QEMU_DISK="$QEMU_VM_DIR/windows11-arm64.qcow2"
QEMU_SHARE="$QEMU_VM_DIR/share"

die() { echo "error: $*" >&2; exit 1; }
note() { echo "==> $*" >&2; }

require_file() {
  [[ -f "$1" ]] || die "required file not found: $1"
}

windows_path() {
  command -v wslpath >/dev/null || die "wslpath is required; run this helper from WSL"
  wslpath -w "$1"
}

monitor_command() {
  local command="$1"
  local escaped="${command//\'/\'\'}"
  powershell.exe -NoProfile -Command "
    \$client = [Net.Sockets.TcpClient]::new('127.0.0.1', $QEMU_MONITOR_PORT)
    try {
      \$writer = [IO.StreamWriter]::new(\$client.GetStream())
      \$writer.AutoFlush = \$true
      \$writer.WriteLine('$escaped')
      Start-Sleep -Milliseconds 250
    } finally {
      \$client.Close()
    }" >/dev/null
}

cmd_check() {
  require_file "$QEMU_SYSTEM"
  require_file "$QEMU_IMG"
  require_file "$QEMU_CODE"
  require_file "$QEMU_VARS_TEMPLATE"
  [[ -n "$QEMU_ARM64_ISO" ]] || die "set QEMU_ARM64_ISO to the Windows ARM64 ISO path"
  [[ -n "$QEMU_ARM64_ISO_SHA256" ]] || die "set QEMU_ARM64_ISO_SHA256 to the publisher's checksum"
  require_file "$QEMU_ARM64_ISO"

  note "verifying Windows ARM64 ISO"
  printf '%s  %s\n' "$QEMU_ARM64_ISO_SHA256" "$QEMU_ARM64_ISO" | sha256sum --check
  "$QEMU_SYSTEM" --version | head -1
  "$QEMU_SYSTEM" -accel help
}

cmd_prepare() {
  [[ $# -ge 1 ]] || die "usage: qemu.sh prepare <arm64-exe> [smoke-args...]"
  local exe="$1"
  shift
  local smoke_args="$*"
  [[ "$smoke_args" != *$'\n'* && "$smoke_args" != *$'\r'* ]] || die "smoke arguments cannot contain newlines"
  require_file "$exe"

  require_file "$QEMU_SYSTEM"
  require_file "$QEMU_IMG"
  require_file "$QEMU_VARS_TEMPLATE"
  [[ -n "$QEMU_ARM64_ISO" ]] || die "set QEMU_ARM64_ISO to the Windows ARM64 ISO path"
  require_file "$QEMU_ARM64_ISO"
  mkdir -p "$QEMU_VM_DIR" "$QEMU_SHARE"

  cp "$exe" "$QEMU_SHARE/app.exe"
  cat > "$QEMU_SHARE/qemu-smoke.cmd" <<EOF
@echo off
echo PROCESSOR_ARCHITECTURE=%PROCESSOR_ARCHITECTURE%
echo PROCESSOR_IDENTIFIER=%PROCESSOR_IDENTIFIER%
"%~dp0app.exe" $smoke_args
echo APP_EXIT_CODE=%ERRORLEVEL%
pause
EOF

  if [[ ! -f "$QEMU_DISK" ]]; then
    note "creating sparse 80 GiB VM disk"
    "$QEMU_IMG" create -f qcow2 "$(windows_path "$QEMU_DISK")" 80G
  fi
  cp "$QEMU_VARS_TEMPLATE" "$QEMU_VARS"

  note "prepared $(basename "$exe") for ARM64 WinPE"
  echo "next:"
  echo "  1. ./scripts/qemu.sh boot"
  echo "  2. ./scripts/qemu.sh boot-key        # from another shell"
  echo "  3. wait for Windows Setup"
  echo "  4. ./scripts/qemu.sh attach"
  echo "  5. Shift+F10, then run:"
  echo '     for %d in (C D E F G H) do @if exist %d:\qemu-smoke.cmd call %d:\qemu-smoke.cmd'
}

cmd_boot() {
  require_file "$QEMU_SYSTEM"
  require_file "$QEMU_CODE"
  require_file "$QEMU_VARS_TEMPLATE"
  [[ -n "$QEMU_ARM64_ISO" ]] || die "set QEMU_ARM64_ISO to the Windows ARM64 ISO path"
  require_file "$QEMU_ARM64_ISO"
  require_file "$QEMU_DISK"
  cp "$QEMU_VARS_TEMPLATE" "$QEMU_VARS"

  local code vars iso disk
  code="$(windows_path "$QEMU_CODE")"
  vars="$(windows_path "$QEMU_VARS")"
  iso="$(windows_path "$QEMU_ARM64_ISO")"
  disk="$(windows_path "$QEMU_DISK")"

  note "starting Windows ARM64 under QEMU TCG"
  exec "$QEMU_SYSTEM" \
    -name PortPilot-Windows11-ARM64 \
    -machine virt,virtualization=on \
    -accel tcg,thread=multi \
    -cpu max -smp 4 -m 8192 \
    -drive "if=pflash,format=raw,readonly=on,file=$code" \
    -drive "if=pflash,format=raw,file=$vars" \
    -device ramfb \
    -device qemu-xhci \
    -device usb-kbd \
    -device usb-tablet \
    -drive "if=none,media=cdrom,readonly=on,id=install,file=$iso" \
    -device usb-storage,drive=install,bootindex=1 \
    -drive "if=none,format=qcow2,id=system,file=$disk" \
    -device nvme,drive=system,serial=PORTPILOT,bootindex=2 \
    -netdev user,id=net0 \
    -device e1000e,netdev=net0 \
    -boot order=d,menu=on,strict=on \
    -monitor "tcp:127.0.0.1:$QEMU_MONITOR_PORT,server=on,wait=off" \
    -display gtk
}

cmd_boot_key() {
  note "resetting and pressing Enter through the ISO boot prompt"
  powershell.exe -NoProfile -Command "
    \$client = [Net.Sockets.TcpClient]::new('127.0.0.1', $QEMU_MONITOR_PORT)
    try {
      \$writer = [IO.StreamWriter]::new(\$client.GetStream())
      \$writer.AutoFlush = \$true
      \$writer.WriteLine('system_reset')
      Start-Sleep -Milliseconds 500
      1..20 | ForEach-Object {
        \$writer.WriteLine('sendkey ret')
        Start-Sleep -Milliseconds 500
      }
    } finally {
      \$client.Close()
    }" >/dev/null
}

cmd_attach() {
  require_file "$QEMU_SHARE/app.exe"
  require_file "$QEMU_SHARE/qemu-smoke.cmd"
  local share
  share="$(windows_path "$QEMU_SHARE")"
  share="${share//\\//}"

  note "hot-plugging the smoke-test USB after UEFI"
  monitor_command "drive_add 0 if=none,file=fat:ro:$share,format=raw,readonly=on,id=share"
  sleep 1
  monitor_command "device_add usb-storage,drive=share,id=share-usb,removable=on"
}

cmd_capture() {
  [[ $# -eq 1 ]] || die "usage: qemu.sh capture <output.ppm>"
  local output="$1"
  mkdir -p "$(dirname "$output")"
  local staging="$QEMU_VM_DIR/screendump.ppm"
  local win_staging
  win_staging="$(windows_path "$staging")"
  win_staging="${win_staging//\\//}"
  rm -f "$staging"
  monitor_command "screendump $win_staging"
  sleep 2
  require_file "$staging"
  cp "$staging" "$output"
  file "$output"
}

cmd_status() {
  powershell.exe -NoProfile -Command "
    Get-Process qemu-system-aarch64 -ErrorAction Stop |
      Select-Object Id, CPU, Responding, MainWindowTitle |
      Format-List"
}

cmd_stop() {
  note "stopping QEMU through its monitor"
  monitor_command quit
}

case "${1:-}" in
  check)    shift; cmd_check "$@" ;;
  prepare)  shift; cmd_prepare "$@" ;;
  boot)     shift; cmd_boot "$@" ;;
  boot-key) shift; cmd_boot_key "$@" ;;
  attach)   shift; cmd_attach "$@" ;;
  capture)  shift; cmd_capture "$@" ;;
  status)   shift; cmd_status "$@" ;;
  stop)     shift; cmd_stop "$@" ;;
  help|--help|-h|"")
    awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "${BASH_SOURCE[0]}"
    ;;
  *) die "unknown command: $1" ;;
esac
