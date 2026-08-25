#!/usr/bin/env bash
# vm.sh - talk to the Windows ARM64 verification VM.
#
# Two transports, tried in this order:
#   ssh          - fast, interactive-friendly. Needs OpenSSH Server on the VM.
#   az-run-cmd   - Azure agent (`az vm run-command`). Always works on a running
#                  Azure VM even with no SSH and no inbound ports open. Slower
#                  (~15-30s per call) and cannot stream, but it is the reliable
#                  fallback.
#
# Config: copy scripts/vm.env.example -> scripts/vm.env and fill it in.
# vm.env is gitignored; it must never be committed.
#
# Auth: Azure Windows VMs ship with a username/password, not a .pem keypair.
# Both work here. VM_AUTH=password uses SSH password auth with connection
# multiplexing, so you type it once per session; `install-key` upgrades you to
# key auth without ever putting a password in a file.
#
# Usage:
#   ./scripts/vm.sh keygen [path]            make an SSH key + VM-side setup script
#   ./scripts/vm.sh init <vm-name>           discover all settings from Azure
#   ./scripts/vm.sh bootstrap                enable OpenSSH Server (no SSH needed)
#   ./scripts/vm.sh connect                  authenticate once, cache for 8h
#   ./scripts/vm.sh install-key              switch from password to key auth
#   ./scripts/vm.sh check                    connectivity + prove the VM is ARM64
#   ./scripts/vm.sh run '<powershell>'       run a PowerShell command on the VM
#   ./scripts/vm.sh push <local> <remote>    copy a file/dir to the VM
#   ./scripts/vm.sh pull <remote> <local>    copy a file/dir back
#   ./scripts/vm.sh verify <remote-exe>      dumpbin + runtime architecture proof
#   ./scripts/vm.sh smoke  <remote-exe> [args]   launch it, prove it ran native
#   ./scripts/vm.sh setup                    install the ARM64 build toolchain
#   ./scripts/vm.sh shell                    interactive SSH session
#   ./scripts/vm.sh disconnect               drop the cached connection

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"

# ---------------------------------------------------------------- config ----
# `init` is what creates vm.env, so it must be allowed to run without it.
if [[ -f "$HERE/vm.env" ]]; then
  # shellcheck disable=SC1091
  source "$HERE/vm.env"
elif [[ "${1:-}" != "init" && "${1:-}" != "keygen" && "${1:-}" != "help" && "${1:-}" != "--help" && "${1:-}" != "-h" ]]; then
  echo "error: $HERE/vm.env not found." >&2
  echo "       ./scripts/vm.sh init <vm-name>   discover settings from Azure, or" >&2
  echo "       cp scripts/vm.env.example scripts/vm.env  and fill it in by hand." >&2
  exit 1
fi

VM_USER="${VM_USER:-azureuser}"
VM_KEY="${VM_KEY:-}"
VM_PORT="${VM_PORT:-22}"
VM_AUTH="${VM_AUTH:-auto}"               # auto | key | password
VM_TRANSPORT="${VM_TRANSPORT:-auto}"     # auto | ssh | az
VM_WORKDIR="${VM_WORKDIR:-C:\\port}"

# Pin az calls to the VM's subscription so a different default doesn't shadow it.
AZ_SUB=()
[[ -n "${VM_SUBSCRIPTION:-}" ]] && AZ_SUB=(--subscription "$VM_SUBSCRIPTION")

die() { echo "error: $*" >&2; exit 1; }
note() { echo "==> $*" >&2; }

# --- auth mode -------------------------------------------------------------
# Azure Windows VMs are provisioned with a username/password, not a .pem key
# (key-pair provisioning is a Linux-image feature). Password auth over SSH works
# fine, so both are supported. `install-key` upgrades password -> key.
if [[ "$VM_AUTH" == auto ]]; then
  if [[ -n "$VM_KEY" && -f "$VM_KEY" ]]; then VM_AUTH=key; else VM_AUTH=password; fi
fi

# Connection multiplexing: with password auth this means you type the password
# once per session and every later command reuses that master connection.
CTRL_DIR="${TMPDIR:-/tmp}/portpilot-ssh-$(id -u)"
mkdir -p "$CTRL_DIR" && chmod 700 "$CTRL_DIR"

SSH_OPTS=(
  -p "$VM_PORT"
  -o StrictHostKeyChecking=accept-new
  -o ConnectTimeout=15
  -o ControlMaster=auto
  -o ControlPath="$CTRL_DIR/%r@%h:%p"
  -o ControlPersist=8h
)
case "$VM_AUTH" in
  key)
    [[ -f "$VM_KEY" ]] || die "VM_AUTH=key but VM_KEY '$VM_KEY' does not exist"
    SSH_OPTS+=(-i "$VM_KEY" -o IdentitiesOnly=yes -o PreferredAuthentications=publickey) ;;
  password)
    SSH_OPTS+=(-o PubkeyAuthentication=no -o PreferredAuthentications=password,keyboard-interactive) ;;
  *) die "unknown VM_AUTH: $VM_AUTH (expected auto|key|password)" ;;
esac
# scp takes -P for the port, ssh takes -p.
SCP_OPTS=("${SSH_OPTS[@]/#-p/-P}")

# ------------------------------------------------------------- transport ----

# Encode PowerShell as base64 UTF-16LE so we never fight three layers of quoting
# (bash -> ssh -> cmd.exe -> powershell). This is the only reliable way to send
# arbitrary script text to a Windows host over SSH.
ps_encode() { printf '%s' "$1" | iconv -f UTF-8 -t UTF-16LE | base64 -w0; }

# Is a multiplexed master connection already open? (password typed earlier)
mux_alive() {
  [[ -n "${VM_HOST:-}" ]] || return 1
  ssh -O check "${SSH_OPTS[@]}" "$VM_USER@$VM_HOST" 2>/dev/null
}

# Cheap TCP reachability probe - avoids blocking on a password prompt just to
# decide whether the ssh transport is usable.
port_open() {
  timeout 6 bash -c "exec 3<>/dev/tcp/$VM_HOST/$VM_PORT" 2>/dev/null
}

have_ssh() {
  [[ -n "${VM_HOST:-}" ]] || return 1
  if [[ "$VM_AUTH" == key ]]; then
    ssh "${SSH_OPTS[@]}" -o BatchMode=yes -o ConnectTimeout=8 "$VM_USER@$VM_HOST" "exit" 2>/dev/null
  else
    mux_alive || port_open
  fi
}

run_ssh() {
  local enc; enc="$(ps_encode "$1")"
  ssh "${SSH_OPTS[@]}" "$VM_USER@$VM_HOST" "powershell -NoProfile -NonInteractive -EncodedCommand $enc"
}

run_az() {
  [[ -n "${VM_RG:-}" && -n "${VM_NAME:-}" ]] || die "VM_RG and VM_NAME must be set in vm.env for the az transport"
  az vm run-command invoke \
      "${AZ_SUB[@]}" \
      --resource-group "$VM_RG" --name "$VM_NAME" \
      --command-id RunPowerShellScript \
      --scripts "$1" \
      --query 'value[0].message' -o tsv 2>/dev/null \
    | sed -e 's/^\[stdout\]//' -e '/^\[stderr\]$/,$d'
}

# Run PowerShell on the VM via whichever transport is available.
vm_run() {
  local script="$1"
  case "$VM_TRANSPORT" in
    ssh) run_ssh "$script" ;;
    az)  run_az  "$script" ;;
    auto)
      if have_ssh; then run_ssh "$script"; else
        note "ssh unavailable, falling back to az vm run-command"
        run_az "$script"
      fi ;;
    *) die "unknown VM_TRANSPORT: $VM_TRANSPORT" ;;
  esac
}

# ---------------------------------------------------------------- actions ---

cmd_check() {
  note "checking VM connectivity and architecture"
  vm_run '
    $ErrorActionPreference = "Stop"
    "hostname        : $(hostname)"
    "os              : $((Get-CimInstance Win32_OperatingSystem).Caption)"
    "os build        : $((Get-CimInstance Win32_OperatingSystem).Version)"
    "cpu             : $((Get-CimInstance Win32_Processor).Name)"
    "PROCESSOR_ARCH  : $env:PROCESSOR_ARCHITECTURE"
    "dotnet OS arch  : $([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture)"
    "dotnet proc arch: $([System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture)"
    if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") {
      "RESULT          : OK - native ARM64 verification target"
    } else {
      "RESULT          : WARNING - not ARM64 (found $env:PROCESSOR_ARCHITECTURE). Cannot verify a native ARM64 port here."
    }'
}

cmd_run() { [[ $# -ge 1 ]] || die "usage: vm.sh run '<powershell>'"; vm_run "$1"; }

cmd_push() {
  [[ $# -eq 2 ]] || die "usage: vm.sh push <local> <remote>"
  have_ssh || die "push requires ssh (az run-command cannot transfer files). Set VM_HOST, or stage artifacts via a storage account."
  note "pushing $1 -> $2"
  scp "${SCP_OPTS[@]}" -r "$1" "$VM_USER@$VM_HOST:$2"
}

cmd_pull() {
  [[ $# -eq 2 ]] || die "usage: vm.sh pull <remote> <local>"
  have_ssh || die "pull requires ssh"
  note "pulling $1 -> $2"
  scp "${SCP_OPTS[@]}" -r "$VM_USER@$VM_HOST:$1" "$2"
}

# The S6 architecture gate: is this binary really ARM64?
cmd_verify() {
  [[ $# -eq 1 ]] || die "usage: vm.sh verify <remote-path-to-exe-or-dir>"
  note "verifying architecture of $1"
  vm_run "
    \$ErrorActionPreference = 'Stop'
    \$target = '$1'

    # locate dumpbin from any installed VS
    \$vswhere = \"\${env:ProgramFiles(x86)}\\Microsoft Visual Studio\\Installer\\vswhere.exe\"
    \$dumpbin = \$null
    if (Test-Path \$vswhere) {
      \$vs = & \$vswhere -latest -products * -property installationPath
      if (\$vs) { \$dumpbin = Get-ChildItem -Path \$vs -Filter dumpbin.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName }
    }

    \$items = if (Test-Path \$target -PathType Container) {
      Get-ChildItem -Path \$target -Recurse -Include *.exe,*.dll -File
    } else { Get-Item \$target }

    \$bad = @()
    foreach (\$i in \$items) {
      if (\$dumpbin) {
        \$line = (& \$dumpbin /headers \$i.FullName | Select-String 'machine \(' | Select-Object -First 1)
        \$txt  = if (\$line) { \$line.ToString().Trim() } else { 'no machine line' }
      } else {
        # fallback: read the PE COFF machine field directly, no VS required
        \$fs = [System.IO.File]::OpenRead(\$i.FullName)
        \$br = New-Object System.IO.BinaryReader(\$fs)
        \$fs.Position = 0x3C; \$pe = \$br.ReadInt32(); \$fs.Position = \$pe + 4
        \$m = \$br.ReadUInt16(); \$br.Close(); \$fs.Close()
        \$name = switch (\$m) { 0x8664 {'x64'} 0xAA64 {'ARM64'} 0x14C {'x86'} default {\"unknown(0x\$(\$m.ToString('X4')))\"} }
        \$txt = \"0x\$(\$m.ToString('X4')) machine (\$name)\"
      }
      '{0,-40} {1}' -f \$i.Name, \$txt
      if (\$txt -notmatch 'AA64') { \$bad += \$i.Name }
    }

    ''
    if (\$bad.Count -gt 0) { \"RESULT: FAIL - not ARM64: \$(\$bad -join ', ')\"; exit 1 }
    else { \"RESULT: PASS - all \$(\$items.Count) binaries are ARM64 (AA64)\" }"
}

# Launch the app and prove the running process is native, not emulated.
cmd_smoke() {
  [[ $# -ge 1 ]] || die "usage: vm.sh smoke <remote-exe> [args...]"
  local exe="$1"; shift
  local args="${*:-}"
  note "smoke-testing $exe"
  vm_run "
    \$ErrorActionPreference = 'Stop'
    \$exe = '$exe'
    if (-not (Test-Path \$exe)) { \"RESULT: FAIL - not found: \$exe\"; exit 1 }

    \$p = Start-Process -FilePath \$exe -ArgumentList '$args' -PassThru
    Start-Sleep -Seconds 5

    if (\$p.HasExited) {
      \"process exited early with code \$(\$p.ExitCode)\"
    } else {
      # IsWow64Process2: nonzero ProcessMachine means the process is EMULATED.
      Add-Type -Namespace W -Name N -MemberDefinition '
        [DllImport(\"kernel32.dll\", SetLastError=true)]
        public static extern bool IsWow64Process2(IntPtr h, out ushort p, out ushort n);'
      \$pm = 0; \$nm = 0
      [void][W.N]::IsWow64Process2(\$p.Handle, [ref]\$pm, [ref]\$nm)
      \"process machine : 0x\$(\$pm.ToString('X4'))  (0x0000 = NOT emulated / native)\"
      \"native machine  : 0x\$(\$nm.ToString('X4'))  (0xAA64 = ARM64 host)\"

      \$x64mods = \$p.Modules | Where-Object { \$_.FileName -notlike '*\\\\WinSxS\\\\*' } | ForEach-Object { \$_.ModuleName }
      \"modules loaded  : \$(\$p.Modules.Count)\"

      if (\$pm -eq 0) { \"RESULT: PASS - running NATIVE ARM64\" }
      else { \"RESULT: FAIL - running EMULATED (process machine 0x\$(\$pm.ToString('X4')))\" }
      Stop-Process -Id \$p.Id -Force -ErrorAction SilentlyContinue
    }"
}

# Install the ARM64 build toolchain on the VM (idempotent).
cmd_setup() {
  note "installing ARM64 build toolchain on the VM (this takes a while)"
  vm_run '
    $ErrorActionPreference = "Continue"
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
      "winget not found - install VS Build Tools manually, or use the Visual Studio Installer."
    }

    New-Item -ItemType Directory -Force -Path "C:\port" | Out-Null

    "installing Git, CMake, Python, Node..."
    winget install --id Git.Git            --accept-source-agreements --accept-package-agreements --silent -e 2>&1 | Out-Null
    winget install --id Kitware.CMake      --accept-source-agreements --accept-package-agreements --silent -e 2>&1 | Out-Null

    "installing VS 2022 Build Tools with ARM64/ARM64EC support..."
    # --add components: native desktop workload + ARM64 and ARM64EC compilers
    winget install --id Microsoft.VisualStudio.2022.BuildTools --silent -e --accept-source-agreements --accept-package-agreements `
      --override "--quiet --wait --norestart --nocache \
        --add Microsoft.VisualStudio.Workload.VCTools \
        --add Microsoft.VisualStudio.Component.VC.Tools.ARM64 \
        --add Microsoft.VisualStudio.Component.VC.Tools.ARM64EC \
        --add Microsoft.VisualStudio.Component.Windows11SDK.22621" 2>&1 | Out-Null

    "done. verify with: vm.sh run ''Get-Command cl, cmake, git''"'
}

cmd_shell() {
  [[ -n "${VM_HOST:-}" ]] || die "interactive shell requires VM_HOST in vm.env"
  exec ssh "${SSH_OPTS[@]}" "$VM_USER@$VM_HOST"
}

# Open the multiplexed master connection. With password auth you type the
# password ONCE here; every later vm.sh call reuses this socket silently.
cmd_connect() {
  [[ -n "${VM_HOST:-}" ]] || die "VM_HOST must be set in vm.env"
  if mux_alive; then note "already connected to $VM_USER@$VM_HOST"; return 0; fi
  note "opening master connection to $VM_USER@$VM_HOST (password prompt follows)"
  ssh "${SSH_OPTS[@]}" -fN "$VM_USER@$VM_HOST" \
    || die "connection failed. Run './scripts/vm.sh bootstrap' if OpenSSH Server is not enabled yet."
  mux_alive && note "connected. Session cached for 8h; later commands need no password."
}

cmd_disconnect() {
  mux_alive || { note "no active connection"; return 0; }
  ssh -O exit "${SSH_OPTS[@]}" "$VM_USER@$VM_HOST" 2>/dev/null || true
  note "disconnected"
}

# Generate a local keypair and print the script that authorises it on the VM.
#
# Azure has no SSH-key provisioning for Windows images - the "SSH keys" resource
# in the portal is Linux-only and cannot be attached to a Windows VM. So the key
# is made here and installed on the VM once, by hand, over RDP. After that, SSH
# is plain `ssh -i <key> user@host` with no Azure CLI involved.
cmd_keygen() {
  local keyfile="${1:-$HOME/.ssh/portpilot_arm64}"

  if [[ -f "$keyfile" ]]; then
    note "reusing existing key $keyfile"
  else
    note "generating $keyfile"
    local kdir; kdir="$(dirname "$keyfile")"
    [[ -d "$kdir" ]] || { mkdir -p "$kdir" && chmod 700 "$kdir"; }
    ssh-keygen -t ed25519 -N '' -C "portpilot-arm64" -f "$keyfile" >/dev/null
  fi
  chmod 600 "$keyfile"
  local pub; pub="$(cat "$keyfile.pub")"

  cat <<EOF

  Private key : $keyfile        (stays here, never leaves this machine)
  Public key  : $keyfile.pub

------------------------------------------------------------------------------
STEP 1  RDP into the VM with your username + password, open PowerShell as
        Administrator, and paste this whole block:
------------------------------------------------------------------------------

\$pub = '$pub'

# OpenSSH Server (Windows ships it as an optional capability, off by default)
\$cap = Get-WindowsCapability -Online | Where-Object Name -like 'OpenSSH.Server*' | Select-Object -First 1
if (\$cap.State -ne 'Installed') { Add-WindowsCapability -Online -Name \$cap.Name }
Set-Service sshd -StartupType Automatic
Start-Service sshd

# Allow port 22 through the Windows firewall
if (-not (Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -DisplayName 'OpenSSH Server (sshd)' \`
    -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22
}

# Authorise the key. Administrators use administrators_authorized_keys, NOT
# ~/.ssh/authorized_keys, and sshd ignores the file unless the ACL is locked
# down to Administrators + SYSTEM. UTF8-no-BOM or the first key is ignored.
\$f = 'C:\\ProgramData\\ssh\\administrators_authorized_keys'
\$lines = @(); if (Test-Path \$f) { \$lines = @(Get-Content \$f | Where-Object { \$_.Trim() }) }
if (\$lines -notcontains \$pub) { \$lines += \$pub }
[IO.File]::WriteAllLines(\$f, \$lines, (New-Object Text.UTF8Encoding \$false))
icacls \$f /inheritance:r /grant 'Administrators:F' /grant 'SYSTEM:F'
Restart-Service sshd
'OK - sshd running, key authorised'

------------------------------------------------------------------------------
STEP 2  Allow port 22 inbound in the Azure portal (one click, no CLI):
        VM -> Networking -> Network settings -> Create port rule -> Inbound
        Destination port 22, TCP, Allow. Restrict Source to 'My IP address'.
------------------------------------------------------------------------------
STEP 3  Test from here:

        ssh -i $keyfile <admin-user>@<public-ip>

        Then record it so the tooling uses it:
        VM_HOST="<public-ip>"
        VM_USER="<admin-user>"
        VM_AUTH="key"
        VM_KEY="$keyfile"
        VM_TRANSPORT="ssh"
------------------------------------------------------------------------------

EOF
}

# Discover every connection setting from Azure and write scripts/vm.env.
# Everything vm.sh needs is derivable from the VM resource itself, so the only
# thing you must supply is enough of the VM name to identify it.
cmd_init() {
  local needle="${1:-}"
  command -v az >/dev/null || die "the Azure CLI is required for init (or hand-write scripts/vm.env)"
  az account show >/dev/null 2>&1 || die "not logged in - run: az login"

  local kql="Resources
    | where type =~ 'microsoft.compute/virtualmachines'
    | where tostring(properties.storageProfile.osDisk.osType) =~ 'Windows'"
  [[ -n "$needle" ]] && kql="$kql | where name contains '$needle'"
  kql="$kql
    | project name, resourceGroup, subscriptionId,
              vmSize    = tostring(properties.hardwareProfile.vmSize),
              adminUser = tostring(properties.osProfile.adminUsername),
              vmId      = id
    | order by name asc"

  note "searching Azure for Windows VMs${needle:+ matching '$needle'}"
  local rows; rows="$(az graph query -q "$kql" --first 100 -o json 2>/dev/null)" \
    || die "Resource Graph query failed. Install the extension: az extension add -n resource-graph"

  local count; count="$(printf '%s' "$rows" | python3 -c 'import json,sys; print(json.load(sys.stdin)["count"])')"
  [[ "$count" == "0" ]] && die "no Windows VMs found${needle:+ matching '$needle'}. Try a different name, or check: az account list -o table"

  if [[ "$count" != "1" ]]; then
    echo "Found $count Windows VMs. Re-run with a more specific name:" >&2
    echo "    ./scripts/vm.sh init <name>" >&2
    echo >&2
    printf '%s' "$rows" | python3 -c '
import json,sys
for r in json.load(sys.stdin)["data"]:
    arm = "ARM64" if __import__("re").search(r"Standard_[DE]\d+p", r["vmSize"] or "") else "x64  "
    print("  %-28s %-24s %-22s %s" % (r["name"], r["resourceGroup"], r["vmSize"], arm), file=sys.stderr)'
    exit 1
  fi

  eval "$(printf '%s' "$rows" | python3 -c '
import json,sys,shlex
r = json.load(sys.stdin)["data"][0]
for k in ("name","resourceGroup","subscriptionId","vmSize","adminUser","vmId"):
    print("D_%s=%s" % (k, shlex.quote(r.get(k) or "")))')"

  note "found $D_name (rg: $D_resourceGroup, size: $D_vmSize)"
  if [[ ! "$D_vmSize" =~ Standard_[DE][0-9]+p ]]; then
    note "WARNING: $D_vmSize does not look like an ARM64 size (expected e.g. Standard_D4ps_v5)."
    note "         'vm.sh check' will confirm for certain. Evidence gathered on x64 is invalid."
  fi

  note "resolving public IP"
  local ip fqdn
  ip="$(az vm list-ip-addresses --ids "$D_vmId" \
        --query '[0].virtualMachine.network.publicIpAddresses[0].ipAddress' -o tsv 2>/dev/null || true)"
  fqdn="$(az vm list-ip-addresses --ids "$D_vmId" \
        --query '[0].virtualMachine.network.publicIpAddresses[0].fqdns' -o tsv 2>/dev/null || true)"
  local host="${fqdn:-$ip}"
  [[ -z "$host" ]] && note "no public IP - SSH will not work; the az transport still will"

  if [[ -f "$HERE/vm.env" ]]; then
    cp "$HERE/vm.env" "$HERE/vm.env.bak"
    note "existing vm.env backed up to vm.env.bak"
  fi

  cat > "$HERE/vm.env" <<EOF
# Generated by 'vm.sh init' on $(date -u +%Y-%m-%dT%H:%M:%SZ). Gitignored - do not commit.

# --- Azure agent transport (no inbound ports needed; used by bootstrap) ------
VM_SUBSCRIPTION="$D_subscriptionId"
VM_RG="$D_resourceGroup"
VM_NAME="$D_name"

# --- SSH transport ----------------------------------------------------------
VM_HOST="$host"
VM_USER="$D_adminUser"
VM_PORT="22"

# password until you run 'vm.sh install-key', then set VM_AUTH="key"
VM_AUTH="auto"
VM_KEY=""

VM_TRANSPORT="auto"
VM_WORKDIR="C:\\\\port"
EOF
  chmod 600 "$HERE/vm.env"

  echo
  note "wrote $HERE/vm.env"
  echo "    VM_NAME  = $D_name"
  echo "    VM_RG    = $D_resourceGroup"
  echo "    VM_HOST  = ${host:-<none - use VM_TRANSPORT=az>}"
  echo "    VM_USER  = $D_adminUser"
  echo
  note "next:  ./scripts/vm.sh bootstrap    # enable OpenSSH Server"
  note "       ./scripts/vm.sh install-key  # go password-free"
  note "       ./scripts/vm.sh check        # confirm it is really ARM64"
}

# Enable OpenSSH Server on a Windows VM that has never been SSH'd into.
# Runs over the Azure agent, so it needs no SSH and no open inbound port -
# only Azure RBAC on the VM.
cmd_bootstrap() {
  [[ -n "${VM_RG:-}" && -n "${VM_NAME:-}" ]] \
    || die "bootstrap needs VM_RG and VM_NAME in vm.env (find them: az vm list -d -o table)"

  note "enabling OpenSSH Server on $VM_NAME via the Azure agent (~1-2 min)"
  run_az '
    $ErrorActionPreference = "Stop"
    $cap = Get-WindowsCapability -Online | Where-Object { $_.Name -like "OpenSSH.Server*" } | Select-Object -First 1
    if (-not $cap) { "ERROR: OpenSSH.Server capability not offered by this image"; exit 1 }
    if ($cap.State -ne "Installed") {
      "installing $($cap.Name) ..."
      Add-WindowsCapability -Online -Name $cap.Name | Out-Null
    } else { "OpenSSH Server already installed" }

    Set-Service -Name sshd -StartupType Automatic
    Start-Service sshd

    $rule = Get-NetFirewallRule -Name "OpenSSH-Server-In-TCP" -ErrorAction SilentlyContinue
    if ($rule) { Enable-NetFirewallRule -Name "OpenSSH-Server-In-TCP" }
    else {
      New-NetFirewallRule -Name "OpenSSH-Server-In-TCP" -DisplayName "OpenSSH Server (sshd)" `
        -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 | Out-Null
    }

    $cfg = "C:\ProgramData\ssh\sshd_config"
    if (Test-Path $cfg) {
      $pw = Select-String -Path $cfg -Pattern "^\s*PasswordAuthentication\s+no" -Quiet
      "PasswordAuthentication disabled : $([bool]$pw)"
    }
    "sshd status : $((Get-Service sshd).Status)"
    "RESULT      : OpenSSH Server is enabled. Now open port 22 in the NSG."'

  note "opening port 22 in the network security group"
  az vm open-port "${AZ_SUB[@]}" --resource-group "$VM_RG" --name "$VM_NAME" --port 22 --priority 1022 -o none 2>/dev/null \
    || note "port 22 rule already present (or insufficient NSG permissions) - continuing"

  local ip
  ip="$(az vm list-ip-addresses "${AZ_SUB[@]}" -g "$VM_RG" -n "$VM_NAME" \
        --query '[0].virtualMachine.network.publicIpAddresses[0].ipAddress' -o tsv 2>/dev/null || true)"
  [[ -n "$ip" ]] && note "public IP: $ip   -> set VM_HOST=\"$ip\" in scripts/vm.env"
  note "next: ./scripts/vm.sh connect   (or ./scripts/vm.sh install-key to go password-free)"
}

# Upgrade password auth -> key auth. Generates a keypair locally if needed and
# installs the public half over the Azure agent, so the password is only ever
# typed by you, never stored in a file or passed on a command line.
cmd_install_key() {
  [[ -n "${VM_RG:-}" && -n "${VM_NAME:-}" ]] \
    || die "install-key needs VM_RG and VM_NAME in vm.env"

  local keyfile="${VM_KEY:-$HOME/.ssh/portpilot_arm64}"
  if [[ ! -f "$keyfile" ]]; then
    note "generating keypair at $keyfile"
    mkdir -p "$(dirname "$keyfile")"
    ssh-keygen -t ed25519 -N '' -C "portpilot-arm64" -f "$keyfile" >/dev/null
  fi
  chmod 600 "$keyfile"
  local pub; pub="$(cat "$keyfile.pub")"

  note "installing public key on $VM_NAME"
  # Windows OpenSSH reads administrators_authorized_keys - NOT ~/.ssh/authorized_keys -
  # for any user in the Administrators group, and refuses it unless the ACL is
  # restricted to Administrators + SYSTEM. Both are handled here.
  run_az "
    \$ErrorActionPreference = 'Stop'
    \$pub  = '$pub'
    \$path = 'C:\\ProgramData\\ssh\\administrators_authorized_keys'
    New-Item -ItemType Directory -Force -Path 'C:\\ProgramData\\ssh' | Out-Null
    \$lines = @()
    if (Test-Path \$path) { \$lines = @(Get-Content \$path | Where-Object { \$_.Trim() -ne '' }) }
    if (\$lines -notcontains \$pub) { \$lines += \$pub; 'key added' } else { 'key already present' }
    # UTF8 without BOM - a BOM makes sshd ignore the first key
    [System.IO.File]::WriteAllLines(\$path, \$lines, (New-Object System.Text.UTF8Encoding \$false))
    icacls.exe \$path /inheritance:r /grant 'Administrators:F' /grant 'SYSTEM:F' | Out-Null
    Restart-Service sshd
    \"RESULT: installed, \$(\$lines.Count) key(s) authorised\""

  note "done. Set these in scripts/vm.env:"
  echo "    VM_AUTH=\"key\""
  echo "    VM_KEY=\"$keyfile\""
}

# ------------------------------------------------------------------ main ----
case "${1:-}" in
  help|--help|-h)
    awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "${BASH_SOURCE[0]}"
    exit 0 ;;
  init)       shift; cmd_init "$@" ;;
  keygen)     shift; cmd_keygen "$@" ;;
  bootstrap)  shift; cmd_bootstrap "$@" ;;
  install-key) shift; cmd_install_key "$@" ;;
  connect)    shift; cmd_connect "$@" ;;
  disconnect) shift; cmd_disconnect "$@" ;;
  check)  shift; cmd_check "$@" ;;
  run)    shift; cmd_run "$@" ;;
  push)   shift; cmd_push "$@" ;;
  pull)   shift; cmd_pull "$@" ;;
  verify) shift; cmd_verify "$@" ;;
  smoke)  shift; cmd_smoke "$@" ;;
  setup)  shift; cmd_setup "$@" ;;
  shell)  shift; cmd_shell "$@" ;;
  *)
    # print the leading comment block as usage, stopping at the first code line
    awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "${BASH_SOURCE[0]}"
    exit 1 ;;
esac
