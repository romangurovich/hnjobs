#!/usr/bin/env bash
#
# OCI Infrastructure Setup Script for HN Jobs
# 
# This script provisions the complete Oracle Cloud infrastructure:
# - VCN with public subnet
# - Internet Gateway and routing
# - Security lists for SSH, HTTP, HTTPS
# - 2x ARM A1.Flex Worker VMs (1 OCPU, 6GB RAM each) for Temporal workers
# - 1x AMD E2.1.Micro Admin VM (1/8 OCPU, 1GB RAM) for Admin API + Caddy
# - Cloud-init for automated setup (Bun, deploy user, Caddy)
#
# Free Tier Usage: ARM 4/4 OCPU, 16/24GB | AMD 1/1 Micro instance
#
# Usage: ./scripts/oci-setup.sh
#
set -euo pipefail

# Increase OCI CLI timeout for slow API responses
export OCI_CLI_READ_TIMEOUT=300

# =============================================================================
# CONFIGURATION
# =============================================================================

# Resource naming
PREFIX="hnjobs"
VCN_NAME="${PREFIX}-vcn"
IGW_NAME="${PREFIX}-igw"
RT_NAME="${PREFIX}-rt"
SL_NAME="${PREFIX}-sl"
SUBNET_NAME="${PREFIX}-subnet"
WORKER_VM_NAME="${PREFIX}-worker"
ADMIN_VM_NAME="${PREFIX}-admin"
TEMPORAL_VM_NAME="${PREFIX}-temporal"

# Network configuration
VCN_CIDR="10.0.0.0/16"
SUBNET_CIDR="10.0.1.0/24"

# VM configuration (Always Free tier)
# ARM A1.Flex: 4 OCPUs / 24GB total
#   - 2x workers (1 OCPU, 6GB each) = 2 OCPU, 12GB
#   - 1x temporal (2 OCPU, 12GB) = 2 OCPU, 12GB
#   - Total ARM: 4 OCPU, 24GB (fully utilized)
# AMD E2.1.Micro: 1/8 OCPU / 1GB - using 1x admin
WORKER_SHAPE="VM.Standard.A1.Flex"
WORKER_COUNT=2
WORKER_OCPUS=1
WORKER_MEMORY_GB=6

TEMPORAL_SHAPE="VM.Standard.A1.Flex"
TEMPORAL_OCPUS=2
TEMPORAL_MEMORY_GB=12

ADMIN_SHAPE="VM.Standard.E2.1.Micro"
# Note: E2.1.Micro is fixed at 1/8 OCPU and 1GB RAM, no shape config needed

BOOT_VOLUME_SIZE_GB=50

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLOUD_INIT_DIR="${SCRIPT_DIR}/cloud-init"
OUTPUT_FILE="${SCRIPT_DIR}/infra-output.json"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_section() {
    echo ""
    echo -e "${BOLD}${CYAN}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${BOLD}${CYAN}  $1${NC}"
    echo -e "${BOLD}${CYAN}════════════════════════════════════════════════════════════════${NC}"
    echo ""
}

print_resource() {
    local type="$1"
    local name="$2"
    local ocid="$3"
    echo -e "  ${GREEN}✓${NC} ${BOLD}${type}${NC}: ${name}"
    echo -e "    OCID: ${CYAN}${ocid}${NC}"
}

prompt_input() {
    local prompt="$1"
    local default="${2:-}"
    local result
    
    if [ -n "$default" ]; then
        read -rp "$(echo -e "${YELLOW}$prompt${NC} [$default]: ")" result
        echo "${result:-$default}"
    else
        read -rp "$(echo -e "${YELLOW}$prompt${NC}: ")" result
        echo "$result"
    fi
}

prompt_yes_no() {
    local prompt="$1"
    local default="${2:-y}"
    local result
    
    read -rp "$(echo -e "${YELLOW}$prompt${NC} [${default}]: ")" result
    result="${result:-$default}"
    [[ "$result" =~ ^[Yy] ]]
}

check_command() {
    if ! command -v "$1" &> /dev/null; then
        log_error "$1 is required but not installed."
        return 1
    fi
}

# Retry wrapper for OCI CLI commands that may timeout
oci_retry() {
    local max_attempts=3
    local delay=10
    local attempt=1
    local stdout_output
    local stderr_output
    local exit_code
    local tmpfile
    tmpfile=$(mktemp)
    
    while [ $attempt -le $max_attempts ]; do
        # Capture stdout and stderr separately
        stdout_output=$("$@" 2>"$tmpfile") && exit_code=0 || exit_code=$?
        stderr_output=$(cat "$tmpfile")
        
        if [ $exit_code -eq 0 ]; then
            rm -f "$tmpfile"
            echo "$stdout_output"
            return 0
        fi
        
        # Check if it's a timeout error (in stderr)
        if echo "$stderr_output" | grep -qi "timed out\|timeout\|RequestException"; then
            log_warn "OCI API timeout (attempt $attempt/$max_attempts). Retrying in ${delay}s..." >&2
            sleep $delay
            delay=$((delay * 2))  # Exponential backoff
            attempt=$((attempt + 1))
        else
            # Not a timeout, return the error immediately
            rm -f "$tmpfile"
            echo "$stderr_output" >&2
            return $exit_code
        fi
    done
    
    rm -f "$tmpfile"
    log_error "OCI API failed after $max_attempts attempts" >&2
    echo "$stderr_output" >&2
    return 1
}

# =============================================================================
# PRE-FLIGHT CHECKS
# =============================================================================

preflight_checks() {
    log_section "Pre-flight Checks"
    
    # Check OCI CLI
    log_info "Checking OCI CLI installation..."
    if ! check_command oci; then
        echo ""
        echo "Install OCI CLI: https://docs.oracle.com/en-us/iaas/Content/API/SDKDocs/cliinstall.htm"
        exit 1
    fi
    log_success "OCI CLI found: $(oci --version 2>&1 | head -1)"
    
    # Check jq
    log_info "Checking jq installation..."
    if ! check_command jq; then
        echo ""
        echo "Install jq: sudo apt-get install jq"
        exit 1
    fi
    log_success "jq found: $(jq --version)"
    
    # Check OCI CLI configuration
    log_info "Checking OCI CLI configuration..."
    if ! oci iam region list --output table &> /dev/null; then
        log_error "OCI CLI is not configured. Run: oci setup config"
        exit 1
    fi
    log_success "OCI CLI is configured and authenticated"
    
    # Check cloud-init templates exist
    log_info "Checking cloud-init templates..."
    if [ ! -f "${CLOUD_INIT_DIR}/worker-init.yaml" ]; then
        log_error "Missing ${CLOUD_INIT_DIR}/worker-init.yaml"
        exit 1
    fi
    if [ ! -f "${CLOUD_INIT_DIR}/admin-init.yaml" ]; then
        log_error "Missing ${CLOUD_INIT_DIR}/admin-init.yaml"
        exit 1
    fi
    if [ ! -f "${CLOUD_INIT_DIR}/temporal-init.yaml" ]; then
        log_error "Missing ${CLOUD_INIT_DIR}/temporal-init.yaml"
        exit 1
    fi
    log_success "Cloud-init templates found"
}

# =============================================================================
# CONFIGURATION GATHERING
# =============================================================================

gather_configuration() {
    log_section "Configuration"
    
    # List available compartments
    log_info "Fetching available compartments..."
    echo ""
    oci iam compartment list --compartment-id-in-subtree true --all \
        --query "data[?\"lifecycle-state\"=='ACTIVE'].{Name:name, OCID:id}" \
        --output table 2>/dev/null || true
    echo ""
    
    # Get compartment
    COMPARTMENT_ID=$(prompt_input "Enter Compartment OCID (or 'root' to use tenancy)")
    if [ "$COMPARTMENT_ID" = "root" ]; then
        COMPARTMENT_ID=$(oci iam compartment list --query "data[0].\"compartment-id\"" --raw-output 2>/dev/null)
        log_info "Using root tenancy: $COMPARTMENT_ID"
    fi
    
    # List available regions
    log_info "Fetching available regions..."
    echo ""
    oci iam region-subscription list \
        --query "data[].{Region:\"region-name\", Status:status}" \
        --output table 2>/dev/null || true
    echo ""
    
    # Get region
    CURRENT_REGION=$(oci iam region-subscription list --query "data[0].\"region-name\"" --raw-output 2>/dev/null)
    REGION=$(prompt_input "Enter region" "$CURRENT_REGION")
    
    # Get SSH public key
    DEFAULT_SSH_KEY="$HOME/.ssh/id_rsa.pub"
    if [ ! -f "$DEFAULT_SSH_KEY" ]; then
        DEFAULT_SSH_KEY="$HOME/.ssh/id_ed25519.pub"
    fi
    
    SSH_KEY_PATH=$(prompt_input "Enter SSH public key path" "$DEFAULT_SSH_KEY")
    if [ ! -f "$SSH_KEY_PATH" ]; then
        log_error "SSH public key not found: $SSH_KEY_PATH"
        if prompt_yes_no "Generate a new SSH keypair?" "y"; then
            SSH_KEY_PATH="$HOME/.ssh/hnjobs_deploy"
            ssh-keygen -t ed25519 -f "$SSH_KEY_PATH" -N "" -C "hnjobs-deploy"
            SSH_KEY_PATH="${SSH_KEY_PATH}.pub"
            log_success "Generated new keypair: $SSH_KEY_PATH"
        else
            exit 1
        fi
    fi
    SSH_PUBLIC_KEY=$(cat "$SSH_KEY_PATH")

    # Get repository URL for initial clone on VMs
    DEFAULT_REPO_URL=$(git config --get remote.origin.url 2>/dev/null || echo "https://github.com/your-org/hnjobs.git")
    REPO_URL=$(prompt_input "Enter repository URL for VM bootstrap clone" "$DEFAULT_REPO_URL")
    if [ -z "$REPO_URL" ]; then
        log_error "Repository URL cannot be empty"
        exit 1
    fi
    
    # Get admin domain for Caddy SSL
    ADMIN_DOMAIN=$(prompt_input "Enter admin domain for HTTPS (e.g., admin.hnjobs.example.com)")
    if [ -z "$ADMIN_DOMAIN" ]; then
        log_warn "No domain provided. Caddy will use self-signed certificate."
        ADMIN_DOMAIN="localhost"
    fi
    
    # Summary
    echo ""
    log_info "Configuration Summary:"
    echo -e "  Compartment: ${CYAN}${COMPARTMENT_ID}${NC}"
    echo -e "  Region:      ${CYAN}${REGION}${NC}"
    echo -e "  SSH Key:     ${CYAN}${SSH_KEY_PATH}${NC}"
    echo -e "  Repo URL:    ${CYAN}${REPO_URL}${NC}"
    echo -e "  Admin Domain:${CYAN}${ADMIN_DOMAIN}${NC}"
    echo ""
    
    if ! prompt_yes_no "Proceed with this configuration?" "y"; then
        log_info "Aborted by user."
        exit 0
    fi
}

# =============================================================================
# NETWORKING SETUP
# =============================================================================

setup_networking() {
    log_section "Networking Setup"
    
    # --- VCN ---
    log_info "Creating VCN: $VCN_NAME..."
    
    # Check if VCN already exists
    EXISTING_VCN=$(oci network vcn list \
        --compartment-id "$COMPARTMENT_ID" \
        --display-name "$VCN_NAME" \
        --query "data[0].id" \
        --raw-output 2>/dev/null || echo "null")
    
    if [ "$EXISTING_VCN" != "null" ] && [ -n "$EXISTING_VCN" ]; then
        log_warn "VCN already exists, reusing..."
        VCN_ID="$EXISTING_VCN"
    else
        VCN_RESULT=$(oci network vcn create \
            --compartment-id "$COMPARTMENT_ID" \
            --display-name "$VCN_NAME" \
            --cidr-blocks "[\"${VCN_CIDR}\"]" \
            --dns-label "hnjobs" \
            --wait-for-state AVAILABLE \
            --query "data" \
            2>/dev/null)
        VCN_ID=$(echo "$VCN_RESULT" | jq -r '.id')
    fi
    print_resource "VCN" "$VCN_NAME" "$VCN_ID"
    
    # --- Internet Gateway ---
    log_info "Creating Internet Gateway: $IGW_NAME..."
    
    EXISTING_IGW=$(oci network internet-gateway list \
        --compartment-id "$COMPARTMENT_ID" \
        --vcn-id "$VCN_ID" \
        --display-name "$IGW_NAME" \
        --query "data[0].id" \
        --raw-output 2>/dev/null || echo "null")
    
    if [ "$EXISTING_IGW" != "null" ] && [ -n "$EXISTING_IGW" ]; then
        log_warn "Internet Gateway already exists, reusing..."
        IGW_ID="$EXISTING_IGW"
    else
        IGW_RESULT=$(oci network internet-gateway create \
            --compartment-id "$COMPARTMENT_ID" \
            --vcn-id "$VCN_ID" \
            --display-name "$IGW_NAME" \
            --is-enabled true \
            --wait-for-state AVAILABLE \
            --query "data" \
            2>/dev/null)
        IGW_ID=$(echo "$IGW_RESULT" | jq -r '.id')
    fi
    print_resource "Internet Gateway" "$IGW_NAME" "$IGW_ID"
    
    # --- Route Table ---
    log_info "Creating Route Table: $RT_NAME..."
    
    EXISTING_RT=$(oci network route-table list \
        --compartment-id "$COMPARTMENT_ID" \
        --vcn-id "$VCN_ID" \
        --display-name "$RT_NAME" \
        --query "data[0].id" \
        --raw-output 2>/dev/null || echo "null")
    
    if [ "$EXISTING_RT" != "null" ] && [ -n "$EXISTING_RT" ]; then
        log_warn "Route Table already exists, reusing..."
        RT_ID="$EXISTING_RT"
    else
        ROUTE_RULES='[{"destination":"0.0.0.0/0","destinationType":"CIDR_BLOCK","networkEntityId":"'"$IGW_ID"'"}]'
        RT_RESULT=$(oci network route-table create \
            --compartment-id "$COMPARTMENT_ID" \
            --vcn-id "$VCN_ID" \
            --display-name "$RT_NAME" \
            --route-rules "$ROUTE_RULES" \
            --wait-for-state AVAILABLE \
            --query "data" \
            2>/dev/null)
        RT_ID=$(echo "$RT_RESULT" | jq -r '.id')
    fi
    print_resource "Route Table" "$RT_NAME" "$RT_ID"
    
    # --- Security List ---
    log_info "Creating Security List: $SL_NAME..."
    
    EXISTING_SL=$(oci network security-list list \
        --compartment-id "$COMPARTMENT_ID" \
        --vcn-id "$VCN_ID" \
        --display-name "$SL_NAME" \
        --query "data[0].id" \
        --raw-output 2>/dev/null || echo "null")
    
    if [ "$EXISTING_SL" != "null" ] && [ -n "$EXISTING_SL" ]; then
        log_warn "Security List already exists, reusing..."
        SL_ID="$EXISTING_SL"
    else
        # Ingress rules: SSH (22), HTTP (80), HTTPS (443), Temporal gRPC (7233), Temporal UI (8080)
        INGRESS_RULES='[
            {
                "source": "0.0.0.0/0",
                "protocol": "6",
                "isStateless": false,
                "tcpOptions": {"destinationPortRange": {"min": 22, "max": 22}}
            },
            {
                "source": "0.0.0.0/0",
                "protocol": "6",
                "isStateless": false,
                "tcpOptions": {"destinationPortRange": {"min": 80, "max": 80}}
            },
            {
                "source": "0.0.0.0/0",
                "protocol": "6",
                "isStateless": false,
                "tcpOptions": {"destinationPortRange": {"min": 443, "max": 443}}
            },
            {
                "source": "10.0.0.0/16",
                "protocol": "6",
                "isStateless": false,
                "tcpOptions": {"destinationPortRange": {"min": 7233, "max": 7233}},
                "description": "Temporal gRPC from VCN"
            },
            {
                "source": "0.0.0.0/0",
                "protocol": "6",
                "isStateless": false,
                "tcpOptions": {"destinationPortRange": {"min": 8080, "max": 8080}},
                "description": "Temporal UI"
            },
            {
                "source": "0.0.0.0/0",
                "protocol": "1",
                "isStateless": false,
                "icmpOptions": {"type": 3, "code": 4}
            },
            {
                "source": "10.0.0.0/16",
                "protocol": "1",
                "isStateless": false,
                "icmpOptions": {"type": 3}
            }
        ]'
        
        # Egress rules: Allow all outbound
        EGRESS_RULES='[
            {
                "destination": "0.0.0.0/0",
                "protocol": "all",
                "isStateless": false
            }
        ]'
        
        SL_RESULT=$(oci network security-list create \
            --compartment-id "$COMPARTMENT_ID" \
            --vcn-id "$VCN_ID" \
            --display-name "$SL_NAME" \
            --ingress-security-rules "$INGRESS_RULES" \
            --egress-security-rules "$EGRESS_RULES" \
            --wait-for-state AVAILABLE \
            --query "data" \
            2>/dev/null)
        SL_ID=$(echo "$SL_RESULT" | jq -r '.id')
    fi
    print_resource "Security List" "$SL_NAME" "$SL_ID"
    echo ""
    echo -e "    Ingress Rules:"
    echo -e "      - TCP 22 (SSH) from 0.0.0.0/0"
    echo -e "      - TCP 80 (HTTP) from 0.0.0.0/0"
    echo -e "      - TCP 443 (HTTPS) from 0.0.0.0/0"
    echo -e "      - TCP 7233 (Temporal gRPC) from 10.0.0.0/16 (VCN internal)"
    echo -e "      - TCP 8080 (Temporal UI) from 0.0.0.0/0"
    echo -e "      - ICMP types 3,4 for path MTU discovery"
    echo -e "    Egress Rules:"
    echo -e "      - All protocols to 0.0.0.0/0"
    
    # --- Subnet ---
    log_info "Creating Subnet: $SUBNET_NAME..."
    
    EXISTING_SUBNET=$(oci network subnet list \
        --compartment-id "$COMPARTMENT_ID" \
        --vcn-id "$VCN_ID" \
        --display-name "$SUBNET_NAME" \
        --query "data[0].id" \
        --raw-output 2>/dev/null || echo "null")
    
    if [ "$EXISTING_SUBNET" != "null" ] && [ -n "$EXISTING_SUBNET" ]; then
        log_warn "Subnet already exists, reusing..."
        SUBNET_ID="$EXISTING_SUBNET"
    else
        # Get availability domain
        AD=$(oci iam availability-domain list \
            --compartment-id "$COMPARTMENT_ID" \
            --query "data[0].name" \
            --raw-output 2>/dev/null)
        
        SUBNET_RESULT=$(oci network subnet create \
            --compartment-id "$COMPARTMENT_ID" \
            --vcn-id "$VCN_ID" \
            --display-name "$SUBNET_NAME" \
            --cidr-block "$SUBNET_CIDR" \
            --route-table-id "$RT_ID" \
            --security-list-ids "[\"${SL_ID}\"]" \
            --dns-label "public" \
            --wait-for-state AVAILABLE \
            --query "data" \
            2>/dev/null)
        SUBNET_ID=$(echo "$SUBNET_RESULT" | jq -r '.id')
    fi
    print_resource "Subnet" "$SUBNET_NAME" "$SUBNET_ID"
    echo -e "    CIDR: ${SUBNET_CIDR}"
    
    log_success "Networking setup complete!"
}

# =============================================================================
# COMPUTE PROVISIONING
# =============================================================================

get_images() {
    # Get ARM image for workers
    log_info "Finding latest Oracle Linux ARM image for workers..."
    
    local arm_output
    arm_output=$(oci compute image list \
        --compartment-id "$COMPARTMENT_ID" \
        --operating-system "Oracle Linux" \
        --operating-system-version "8" \
        --shape "$WORKER_SHAPE" \
        --sort-by TIMECREATED \
        --sort-order DESC \
        --query "data[0].id" \
        --raw-output 2>&1) || true
    
    ARM_IMAGE_ID="$arm_output"
    
    if [ -z "$ARM_IMAGE_ID" ] || [ "$ARM_IMAGE_ID" = "null" ] || [[ "$ARM_IMAGE_ID" == *"error"* ]] || [[ "$ARM_IMAGE_ID" == *"Error"* ]]; then
        log_error "Could not find Oracle Linux ARM image for shape $WORKER_SHAPE"
        log_error "OCI output: $arm_output"
        log_info "Tip: Make sure the region supports ARM shapes and you have quota available."
        exit 1
    fi
    
    ARM_IMAGE_NAME=$(oci compute image get \
        --image-id "$ARM_IMAGE_ID" \
        --query "data.\"display-name\"" \
        --raw-output 2>/dev/null || echo "Unknown")
    
    log_success "ARM Image: $ARM_IMAGE_NAME"
    echo -e "    Image OCID: ${CYAN}${ARM_IMAGE_ID}${NC}"
    
    # Get AMD image for admin
    log_info "Finding latest Oracle Linux AMD image for admin..."
    
    local amd_output
    amd_output=$(oci compute image list \
        --compartment-id "$COMPARTMENT_ID" \
        --operating-system "Oracle Linux" \
        --operating-system-version "8" \
        --shape "$ADMIN_SHAPE" \
        --sort-by TIMECREATED \
        --sort-order DESC \
        --query "data[0].id" \
        --raw-output 2>&1) || true
    
    AMD_IMAGE_ID="$amd_output"
    
    if [ -z "$AMD_IMAGE_ID" ] || [ "$AMD_IMAGE_ID" = "null" ] || [[ "$AMD_IMAGE_ID" == *"error"* ]] || [[ "$AMD_IMAGE_ID" == *"Error"* ]]; then
        log_error "Could not find Oracle Linux AMD image for shape $ADMIN_SHAPE"
        log_error "OCI output: $amd_output"
        exit 1
    fi
    
    AMD_IMAGE_NAME=$(oci compute image get \
        --image-id "$AMD_IMAGE_ID" \
        --query "data.\"display-name\"" \
        --raw-output 2>/dev/null || echo "Unknown")
    
    log_success "AMD Image: $AMD_IMAGE_NAME"
    echo -e "    Image OCID: ${CYAN}${AMD_IMAGE_ID}${NC}"
}

get_availability_domain() {
    local ad_output
    ad_output=$(oci iam availability-domain list \
        --compartment-id "$COMPARTMENT_ID" \
        --query "data[0].name" \
        --raw-output 2>&1) || true
    
    AD="$ad_output"
    
    if [ -z "$AD" ] || [ "$AD" = "null" ] || [[ "$AD" == *"error"* ]] || [[ "$AD" == *"Error"* ]]; then
        log_error "Could not determine Availability Domain"
        log_error "OCI output: $ad_output"
        exit 1
    fi
    
    log_info "Using Availability Domain: $AD"
}

generate_cloud_init() {
    local vm_type="$1"
    local template_file="${CLOUD_INIT_DIR}/${vm_type}-init.yaml"
    local output_file="/tmp/${vm_type}-init-generated.yaml"
    
    # Substitute variables in template
    sed -e "s|\${SSH_PUBLIC_KEY}|${SSH_PUBLIC_KEY}|g" \
        -e "s|\${ADMIN_DOMAIN}|${ADMIN_DOMAIN}|g" \
        -e "s|\${REPO_URL}|${REPO_URL}|g" \
        "$template_file" > "$output_file"
    
    echo "$output_file"
}

create_worker_vm() {
    local vm_name="$1"
    local vm_index="$2"
    
    log_info "  Shape: $WORKER_SHAPE | OCPUs: $WORKER_OCPUS | Memory: ${WORKER_MEMORY_GB}GB | Boot: ${BOOT_VOLUME_SIZE_GB}GB" >&2
    
    # Generate cloud-init
    CLOUD_INIT_FILE=$(generate_cloud_init "worker")
    CLOUD_INIT_BASE64=$(base64 -w 0 "$CLOUD_INIT_FILE")
    
    # Shape config for Flex shapes
    SHAPE_CONFIG="{\"ocpus\": $WORKER_OCPUS, \"memoryInGBs\": $WORKER_MEMORY_GB}"
    
    # Create the instance with retry logic for timeouts
    local launch_output
    local launch_exit_code=0
    
    log_info "Launching instance (this may take 2-5 minutes)..." >&2
    
    launch_output=$(oci_retry oci compute instance launch \
        --compartment-id "$COMPARTMENT_ID" \
        --availability-domain "$AD" \
        --display-name "$vm_name" \
        --shape "$WORKER_SHAPE" \
        --shape-config "$SHAPE_CONFIG" \
        --image-id "$ARM_IMAGE_ID" \
        --subnet-id "$SUBNET_ID" \
        --assign-public-ip true \
        --boot-volume-size-in-gbs "$BOOT_VOLUME_SIZE_GB" \
        --metadata "{\"user_data\": \"$CLOUD_INIT_BASE64\"}" \
        --wait-for-state RUNNING \
        --query "data") || launch_exit_code=$?
    
    if [ $launch_exit_code -ne 0 ]; then
        log_error "Failed to launch Worker VM: $vm_name" >&2
        log_error "OCI CLI output: $launch_output" >&2
        echo ""
        return 1
    fi
    
    VM_ID=$(echo "$launch_output" | jq -r '.id' 2>/dev/null)
    if [ -z "$VM_ID" ] || [ "$VM_ID" = "null" ]; then
        log_error "Could not parse VM ID from launch output" >&2
        echo ""
        return 1
    fi
    
    echo "$VM_ID"
}

create_admin_vm() {
    local vm_name="$1"
    
    log_info "  Shape: $ADMIN_SHAPE (1/8 OCPU, 1GB RAM - Always Free AMD) | Boot: ${BOOT_VOLUME_SIZE_GB}GB" >&2
    
    # Generate cloud-init
    CLOUD_INIT_FILE=$(generate_cloud_init "admin")
    CLOUD_INIT_BASE64=$(base64 -w 0 "$CLOUD_INIT_FILE")
    
    # Create the instance with retry logic (E2.1.Micro has fixed shape, no shape-config needed)
    local launch_output
    local launch_exit_code=0
    
    log_info "Launching instance (this may take 2-5 minutes)..." >&2
    
    launch_output=$(oci_retry oci compute instance launch \
        --compartment-id "$COMPARTMENT_ID" \
        --availability-domain "$AD" \
        --display-name "$vm_name" \
        --shape "$ADMIN_SHAPE" \
        --image-id "$AMD_IMAGE_ID" \
        --subnet-id "$SUBNET_ID" \
        --assign-public-ip true \
        --boot-volume-size-in-gbs "$BOOT_VOLUME_SIZE_GB" \
        --metadata "{\"user_data\": \"$CLOUD_INIT_BASE64\"}" \
        --wait-for-state RUNNING \
        --query "data") || launch_exit_code=$?
    
    if [ $launch_exit_code -ne 0 ]; then
        log_error "Failed to launch Admin VM: $vm_name" >&2
        log_error "OCI CLI output: $launch_output" >&2
        echo ""
        return 1
    fi
    
    VM_ID=$(echo "$launch_output" | jq -r '.id' 2>/dev/null)
    if [ -z "$VM_ID" ] || [ "$VM_ID" = "null" ]; then
        log_error "Could not parse VM ID from launch output" >&2
        echo ""
        return 1
    fi
    
    echo "$VM_ID"
}

create_temporal_vm() {
    local vm_name="$1"
    
    log_info "  Shape: $TEMPORAL_SHAPE | OCPUs: $TEMPORAL_OCPUS | Memory: ${TEMPORAL_MEMORY_GB}GB | Boot: ${BOOT_VOLUME_SIZE_GB}GB" >&2
    
    # Generate cloud-init
    CLOUD_INIT_FILE=$(generate_cloud_init "temporal")
    CLOUD_INIT_BASE64=$(base64 -w 0 "$CLOUD_INIT_FILE")
    
    # Shape config for Flex shapes
    SHAPE_CONFIG="{\"ocpus\": $TEMPORAL_OCPUS, \"memoryInGBs\": $TEMPORAL_MEMORY_GB}"
    
    # Create the instance with retry logic for timeouts
    local launch_output
    local launch_exit_code=0
    
    log_info "Launching instance (this may take 2-5 minutes)..." >&2
    
    launch_output=$(oci_retry oci compute instance launch \
        --compartment-id "$COMPARTMENT_ID" \
        --availability-domain "$AD" \
        --display-name "$vm_name" \
        --shape "$TEMPORAL_SHAPE" \
        --shape-config "$SHAPE_CONFIG" \
        --image-id "$ARM_IMAGE_ID" \
        --subnet-id "$SUBNET_ID" \
        --assign-public-ip true \
        --boot-volume-size-in-gbs "$BOOT_VOLUME_SIZE_GB" \
        --metadata "{\"user_data\": \"$CLOUD_INIT_BASE64\"}" \
        --wait-for-state RUNNING \
        --query "data") || launch_exit_code=$?
    
    if [ $launch_exit_code -ne 0 ]; then
        log_error "Failed to launch Temporal VM: $vm_name" >&2
        log_error "OCI CLI output: $launch_output" >&2
        echo ""
        return 1
    fi
    
    VM_ID=$(echo "$launch_output" | jq -r '.id' 2>/dev/null)
    if [ -z "$VM_ID" ] || [ "$VM_ID" = "null" ]; then
        log_error "Could not parse VM ID from launch output" >&2
        echo ""
        return 1
    fi
    
    echo "$VM_ID"
}

get_vm_public_ip() {
    local vm_id="$1"
    
    # Get VNIC attachment
    VNIC_ID=$(oci compute vnic-attachment list \
        --compartment-id "$COMPARTMENT_ID" \
        --instance-id "$vm_id" \
        --query "data[0].\"vnic-id\"" \
        --raw-output 2>/dev/null)
    
    # Get public IP from VNIC
    PUBLIC_IP=$(oci network vnic get \
        --vnic-id "$VNIC_ID" \
        --query "data.\"public-ip\"" \
        --raw-output 2>/dev/null)
    
    echo "$PUBLIC_IP"
}

provision_compute() {
    log_section "Compute Provisioning"
    
    # Verify we have subnet ID from networking setup
    if [ -z "$SUBNET_ID" ] || [ "$SUBNET_ID" = "null" ]; then
        log_error "SUBNET_ID is not set. Networking setup may have failed."
        exit 1
    fi
    log_info "Using Subnet: $SUBNET_ID"
    
    # Track if we created any new VMs (to know if we need to wait for IPs)
    local created_new_vm=false
    
    # Get images for both architectures
    get_images
    
    # Get availability domain
    get_availability_domain
    
    # Verify we have the required values
    if [ -z "$AD" ] || [ "$AD" = "null" ]; then
        log_error "Could not determine Availability Domain."
        exit 1
    fi
    if [ -z "$ARM_IMAGE_ID" ] || [ "$ARM_IMAGE_ID" = "null" ]; then
        log_error "Could not find ARM image for workers."
        exit 1
    fi
    if [ -z "$AMD_IMAGE_ID" ] || [ "$AMD_IMAGE_ID" = "null" ]; then
        log_error "Could not find AMD image for admin."
        exit 1
    fi
    
    echo ""
    
    # Create Worker VMs (ARM pool)
    declare -a WORKER_VM_IDS
    declare -a WORKER_PUBLIC_IPS
    
    for i in $(seq 1 $WORKER_COUNT); do
        local worker_name="${WORKER_VM_NAME}-${i}"
        
        # Check if VM already exists (RUNNING state) - with retry for timeouts
        log_info "Checking if $worker_name exists..."
        local existing_vm=""
        existing_vm=$(oci_retry oci compute instance list \
            --compartment-id "$COMPARTMENT_ID" \
            --display-name "$worker_name" \
            --lifecycle-state RUNNING \
            --query "data[0].id" \
            --raw-output) || existing_vm=""
        
        if [ -n "$existing_vm" ] && [ "$existing_vm" != "null" ]; then
            log_warn "Worker VM $i already exists (RUNNING), reusing..."
            WORKER_VM_IDS[$i]="$existing_vm"
        else
            # Also check for VMs in other states that would block creation
            local any_state_vm=""
            any_state_vm=$(oci_retry oci compute instance list \
                --compartment-id "$COMPARTMENT_ID" \
                --display-name "$worker_name" \
                --query "data[?\"lifecycle-state\"!='TERMINATED'] | [0].id" \
                --raw-output) || any_state_vm=""
            
            if [ -n "$any_state_vm" ] && [ "$any_state_vm" != "null" ]; then
                log_warn "Worker VM $i exists but not RUNNING (may be starting/stopped). Using existing..."
                WORKER_VM_IDS[$i]="$any_state_vm"
            else
                log_info "Creating Worker VM $i: $worker_name..."
                WORKER_VM_IDS[$i]=$(create_worker_vm "$worker_name" "$i")
                if [ -z "${WORKER_VM_IDS[$i]}" ] || [ "${WORKER_VM_IDS[$i]}" = "null" ]; then
                    log_error "Failed to create Worker VM $i"
                    exit 1
                fi
                created_new_vm=true
            fi
        fi
        print_resource "Worker VM $i" "$worker_name" "${WORKER_VM_IDS[$i]}"
        echo ""
    done
    
    # Check if Admin VM already exists (RUNNING state) - with retry for timeouts
    log_info "Checking if $ADMIN_VM_NAME exists..."
    local existing_admin=""
    existing_admin=$(oci_retry oci compute instance list \
        --compartment-id "$COMPARTMENT_ID" \
        --display-name "$ADMIN_VM_NAME" \
        --lifecycle-state RUNNING \
        --query "data[0].id" \
        --raw-output) || existing_admin=""
    
    if [ -n "$existing_admin" ] && [ "$existing_admin" != "null" ]; then
        log_warn "Admin VM already exists (RUNNING), reusing..."
        ADMIN_VM_ID="$existing_admin"
    else
        # Also check for VMs in other states
        local any_state_admin=""
        any_state_admin=$(oci_retry oci compute instance list \
            --compartment-id "$COMPARTMENT_ID" \
            --display-name "$ADMIN_VM_NAME" \
            --query "data[?\"lifecycle-state\"!='TERMINATED'] | [0].id" \
            --raw-output) || any_state_admin=""
        
        if [ -n "$any_state_admin" ] && [ "$any_state_admin" != "null" ]; then
            log_warn "Admin VM exists but not RUNNING (may be starting/stopped). Using existing..."
            ADMIN_VM_ID="$any_state_admin"
        else
            log_info "Creating Admin VM: $ADMIN_VM_NAME..."
            ADMIN_VM_ID=$(create_admin_vm "$ADMIN_VM_NAME")
            if [ -z "$ADMIN_VM_ID" ] || [ "$ADMIN_VM_ID" = "null" ]; then
                log_error "Failed to create Admin VM"
                exit 1
            fi
            created_new_vm=true
        fi
    fi
    print_resource "Admin VM" "$ADMIN_VM_NAME" "$ADMIN_VM_ID"
    
    # Check if Temporal VM already exists (RUNNING state) - with retry for timeouts
    log_info "Checking if $TEMPORAL_VM_NAME exists..."
    local existing_temporal=""
    existing_temporal=$(oci_retry oci compute instance list \
        --compartment-id "$COMPARTMENT_ID" \
        --display-name "$TEMPORAL_VM_NAME" \
        --lifecycle-state RUNNING \
        --query "data[0].id" \
        --raw-output) || existing_temporal=""
    
    if [ -n "$existing_temporal" ] && [ "$existing_temporal" != "null" ]; then
        log_warn "Temporal VM already exists (RUNNING), reusing..."
        TEMPORAL_VM_ID="$existing_temporal"
    else
        # Also check for VMs in other states
        local any_state_temporal=""
        any_state_temporal=$(oci_retry oci compute instance list \
            --compartment-id "$COMPARTMENT_ID" \
            --display-name "$TEMPORAL_VM_NAME" \
            --query "data[?\"lifecycle-state\"!='TERMINATED'] | [0].id" \
            --raw-output) || any_state_temporal=""
        
        if [ -n "$any_state_temporal" ] && [ "$any_state_temporal" != "null" ]; then
            log_warn "Temporal VM exists but not RUNNING (may be starting/stopped). Using existing..."
            TEMPORAL_VM_ID="$any_state_temporal"
        else
            log_info "Creating Temporal VM: $TEMPORAL_VM_NAME..."
            TEMPORAL_VM_ID=$(create_temporal_vm "$TEMPORAL_VM_NAME")
            if [ -z "$TEMPORAL_VM_ID" ] || [ "$TEMPORAL_VM_ID" = "null" ]; then
                log_error "Failed to create Temporal VM"
                exit 1
            fi
            created_new_vm=true
        fi
    fi
    print_resource "Temporal VM" "$TEMPORAL_VM_NAME" "$TEMPORAL_VM_ID"
    
    # Wait for public IPs only if we created new VMs
    if [ "$created_new_vm" = true ]; then
        log_info "Waiting for public IPs to be assigned..."
        sleep 10
    fi
    
    # Get public IPs (with retry for newly created VMs)
    for i in $(seq 1 $WORKER_COUNT); do
        WORKER_PUBLIC_IPS[$i]=$(get_vm_public_ip "${WORKER_VM_IDS[$i]}")
        # Retry once if empty
        if [ -z "${WORKER_PUBLIC_IPS[$i]}" ]; then
            sleep 5
            WORKER_PUBLIC_IPS[$i]=$(get_vm_public_ip "${WORKER_VM_IDS[$i]}")
        fi
    done
    
    ADMIN_PUBLIC_IP=$(get_vm_public_ip "$ADMIN_VM_ID")
    if [ -z "$ADMIN_PUBLIC_IP" ]; then
        sleep 5
        ADMIN_PUBLIC_IP=$(get_vm_public_ip "$ADMIN_VM_ID")
    fi
    
    TEMPORAL_PUBLIC_IP=$(get_vm_public_ip "$TEMPORAL_VM_ID")
    if [ -z "$TEMPORAL_PUBLIC_IP" ]; then
        sleep 5
        TEMPORAL_PUBLIC_IP=$(get_vm_public_ip "$TEMPORAL_VM_ID")
    fi
    
    echo ""
    for i in $(seq 1 $WORKER_COUNT); do
        echo -e "  ${GREEN}✓${NC} Worker VM $i Public IP: ${BOLD}${WORKER_PUBLIC_IPS[$i]}${NC}"
    done
    echo -e "  ${GREEN}✓${NC} Admin VM Public IP:    ${BOLD}${ADMIN_PUBLIC_IP}${NC}"
    echo -e "  ${GREEN}✓${NC} Temporal VM Public IP: ${BOLD}${TEMPORAL_PUBLIC_IP}${NC}"
    
    log_success "Compute provisioning complete!"
    
    # Store for output generation
    WORKER_1_VM_ID="${WORKER_VM_IDS[1]}"
    WORKER_2_VM_ID="${WORKER_VM_IDS[2]}"
    WORKER_1_PUBLIC_IP="${WORKER_PUBLIC_IPS[1]}"
    WORKER_2_PUBLIC_IP="${WORKER_PUBLIC_IPS[2]}"
}

# =============================================================================
# OUTPUT GENERATION
# =============================================================================

# =============================================================================
# MONITORING SETUP
# =============================================================================

setup_monitoring() {
    log_section "OCI Monitoring Setup"
    
    # --- Check if notification topic already exists ---
    EXISTING_TOPIC=$(oci ons topic list \
        --compartment-id "$COMPARTMENT_ID" \
        --name "${PREFIX}-alerts" \
        --lifecycle-state ACTIVE \
        --query "data[0].\"topic-id\"" \
        --raw-output 2>/dev/null || echo "null")
    
    if [ "$EXISTING_TOPIC" != "null" ] && [ -n "$EXISTING_TOPIC" ]; then
        log_info "Monitoring already configured, reusing existing resources..."
        TOPIC_ID="$EXISTING_TOPIC"
        print_resource "Notification Topic" "${PREFIX}-alerts" "$TOPIC_ID"
    else
        # First time setup - ask user
        if ! prompt_yes_no "Set up OCI Monitoring alarms? (Requires email for notifications)" "y"; then
            log_info "Skipping monitoring setup."
            TOPIC_ID="skipped"
            LOG_GROUP_ID="skipped"
            WORKER_LOG_ID="skipped"
            ADMIN_LOG_ID="skipped"
            CADDY_LOG_ID="skipped"
            AGENT_CONFIG_ID="skipped"
            return
        fi
        
        # Get notification email
        NOTIFICATION_EMAIL=$(prompt_input "Enter email for alarm notifications")
        
        if [ -z "$NOTIFICATION_EMAIL" ]; then
            log_warn "No email provided, skipping alarm setup."
            TOPIC_ID="skipped"
            LOG_GROUP_ID="skipped"
            WORKER_LOG_ID="skipped"
            ADMIN_LOG_ID="skipped"
            CADDY_LOG_ID="skipped"
            AGENT_CONFIG_ID="skipped"
            return
        fi
        
        # --- Create Notification Topic ---
        log_info "Creating notification topic: ${PREFIX}-alerts..."
        
        TOPIC_RESULT=$(oci ons topic create \
            --compartment-id "$COMPARTMENT_ID" \
            --name "${PREFIX}-alerts" \
            --description "HN Jobs infrastructure alerts" \
            --query "data" \
            2>/dev/null)
        TOPIC_ID=$(echo "$TOPIC_RESULT" | jq -r '.["topic-id"]')
        print_resource "Notification Topic" "${PREFIX}-alerts" "$TOPIC_ID"
        
        # --- Create Email Subscription ---
        log_info "Creating email subscription..."
        oci ons subscription create \
            --compartment-id "$COMPARTMENT_ID" \
            --topic-id "$TOPIC_ID" \
            --protocol EMAIL \
            --subscription-endpoint "$NOTIFICATION_EMAIL" \
            2>/dev/null || true
        log_success "Email subscription created. Check inbox to confirm!"
    fi
    
    # --- Create Log Group ---
    log_info "Creating log group: ${PREFIX}-logs..."
    
    EXISTING_LOG_GROUP=$(oci logging log-group list \
        --compartment-id "$COMPARTMENT_ID" \
        --display-name "${PREFIX}-logs" \
        --query "data[0].id" \
        --raw-output 2>/dev/null || echo "null")
    
    if [ "$EXISTING_LOG_GROUP" != "null" ] && [ -n "$EXISTING_LOG_GROUP" ]; then
        log_warn "Log group already exists, reusing..."
        LOG_GROUP_ID="$EXISTING_LOG_GROUP"
    else
        LOG_GROUP_RESULT=$(oci logging log-group create \
            --compartment-id "$COMPARTMENT_ID" \
            --display-name "${PREFIX}-logs" \
            --description "HN Jobs application logs" \
            --wait-for-state SUCCEEDED \
            --query "data" \
            2>/dev/null)
        LOG_GROUP_ID=$(echo "$LOG_GROUP_RESULT" | jq -r '.resources[0].identifier // .id' 2>/dev/null)
        
        # Fetch the created log group ID
        if [ -z "$LOG_GROUP_ID" ] || [ "$LOG_GROUP_ID" = "null" ]; then
            LOG_GROUP_ID=$(oci logging log-group list \
                --compartment-id "$COMPARTMENT_ID" \
                --display-name "${PREFIX}-logs" \
                --query "data[0].id" \
                --raw-output 2>/dev/null)
        fi
    fi
    print_resource "Log Group" "${PREFIX}-logs" "$LOG_GROUP_ID"
    
    # --- Create Custom Logs ---
    WORKER_LOG_ID=$(create_custom_log "worker" "Temporal worker service logs")
    ADMIN_LOG_ID=$(create_custom_log "admin" "Admin API service logs")
    CADDY_LOG_ID=$(create_custom_log "caddy" "Caddy reverse proxy access logs")
    
    # --- Create Logging Agent Configuration ---
    create_agent_config
    
    # --- Create Alarms ---
    
    # High CPU Alarm for Worker 1
    create_cpu_alarm "$WORKER_1_VM_ID" "${WORKER_VM_NAME}-1" 80
    
    # High CPU Alarm for Worker 2
    create_cpu_alarm "$WORKER_2_VM_ID" "${WORKER_VM_NAME}-2" 80
    
    # High CPU Alarm for Admin (lower threshold since it's a micro)
    create_cpu_alarm "$ADMIN_VM_ID" "$ADMIN_VM_NAME" 90
    
    # High CPU Alarm for Temporal
    create_cpu_alarm "$TEMPORAL_VM_ID" "$TEMPORAL_VM_NAME" 80
    
    # Instance Health Alarms
    create_health_alarm "$WORKER_1_VM_ID" "${WORKER_VM_NAME}-1"
    create_health_alarm "$WORKER_2_VM_ID" "${WORKER_VM_NAME}-2"
    create_health_alarm "$ADMIN_VM_ID" "$ADMIN_VM_NAME"
    create_health_alarm "$TEMPORAL_VM_ID" "$TEMPORAL_VM_NAME"
    
    log_success "Monitoring setup complete!"
    echo ""
    echo -e "  ${YELLOW}Important:${NC} Check your email ($NOTIFICATION_EMAIL) to confirm the subscription."
}

create_custom_log() {
    local log_name="${PREFIX}-$1"
    local description="$2"
    
    log_info "Creating custom log: $log_name..." >&2
    
    EXISTING_LOG=$(oci logging log list \
        --log-group-id "$LOG_GROUP_ID" \
        --display-name "$log_name" \
        --query "data[0].id" \
        --raw-output 2>/dev/null || echo "null")
    
    if [ "$EXISTING_LOG" != "null" ] && [ -n "$EXISTING_LOG" ]; then
        log_warn "Log already exists, reusing..." >&2
        echo "$EXISTING_LOG"
        return
    fi
    
    oci logging log create \
        --log-group-id "$LOG_GROUP_ID" \
        --display-name "$log_name" \
        --log-type CUSTOM \
        --wait-for-state SUCCEEDED \
        >/dev/null 2>&1 || { log_warn "Failed to create log: $log_name" >&2; }
    
    # Fetch the created log ID
    LOG_ID=$(oci logging log list \
        --log-group-id "$LOG_GROUP_ID" \
        --display-name "$log_name" \
        --query "data[0].id" \
        --raw-output 2>/dev/null)
    
    echo -e "  ${GREEN}✓${NC} Created log: $log_name" >&2
    echo "$LOG_ID"
}

create_agent_config() {
    log_info "Creating unified logging agent configuration..."
    
    local config_name="${PREFIX}-logging-config"
    
    EXISTING_CONFIG=$(oci logging agent-configuration list \
        --compartment-id "$COMPARTMENT_ID" \
        --display-name "$config_name" \
        --lifecycle-state ACTIVE \
        --query "data[0].id" \
        --raw-output 2>/dev/null || echo "null")
    
    if [ "$EXISTING_CONFIG" != "null" ] && [ -n "$EXISTING_CONFIG" ]; then
        log_warn "Agent config already exists, reusing..."
        AGENT_CONFIG_ID="$EXISTING_CONFIG"
        echo -e "  ${GREEN}✓${NC} Agent configuration: $config_name"
        return
    fi
    
    # Agent configuration requires specific IAM policies
    # Skip automatic creation and provide manual instructions
    log_warn "Agent Configuration requires manual setup (see DEPLOYMENT.md)"
    AGENT_CONFIG_ID="manual-setup-required"
    
    echo ""
    echo -e "  ${YELLOW}══════════════════════════════════════════════════════════════════${NC}"
    echo -e "  ${YELLOW}  MANUAL SETUP: Create Agent Configuration in OCI Console${NC}"
    echo -e "  ${YELLOW}══════════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo "  URL: https://cloud.oracle.com/logging/agent-configs?region=${REGION}"
    echo ""
    echo "  Step 1 - Basic Information:"
    echo "    • Name:               ${config_name}"
    echo "    • Compartment:        (your compartment)"
    echo "    • Configuration Type: Logging"
    echo ""
    echo "  Step 2 - Host Groups:"
    echo "    • Select 'All instances in compartment' → your compartment"
    echo ""
    echo "  Step 3 - Log Inputs (add 3 sources):"
    echo "    ┌──────────────┬────────────────────────────────────┬─────────┐"
    echo "    │ Name         │ Path                               │ Parser  │"
    echo "    ├──────────────┼────────────────────────────────────┼─────────┤"
    echo "    │ syslog       │ /var/log/messages                  │ SYSLOG  │"
    echo "    │ worker-logs  │ /opt/hnjobs/packages/worker/*.log  │ NONE    │"
    echo "    │ caddy-access │ /var/log/caddy/access.log          │ JSON    │"
    echo "    └──────────────┴────────────────────────────────────┴─────────┘"
    echo ""
    echo "  Step 4 - Log Destination:"
    echo "    • Log Group: ${PREFIX}-logs"
    echo "    • Log Name:  ${PREFIX}-worker (or ${PREFIX}-admin)"
    echo ""
    echo -e "  ${YELLOW}Required IAM Policy (Identity → Policies):${NC}"
    echo "    allow any-user to use log-content in compartment <name> where request.principal.type='instance'"
    echo ""
    echo "  See DEPLOYMENT.md for full setup guide and troubleshooting."
    echo ""
}

create_cpu_alarm() {
    local instance_id="$1"
    local instance_name="$2"
    local threshold="$3"
    local alarm_name="${instance_name}-high-cpu"
    
    log_info "Creating CPU alarm for $instance_name (>${threshold}%)..."
    
    EXISTING_ALARM=$(oci monitoring alarm list \
        --compartment-id "$COMPARTMENT_ID" \
        --display-name "$alarm_name" \
        --lifecycle-state ACTIVE \
        --query "data[0].id" \
        --raw-output 2>/dev/null || echo "null")
    
    if [ "$EXISTING_ALARM" != "null" ] && [ -n "$EXISTING_ALARM" ]; then
        log_warn "Alarm already exists, skipping..."
        return
    fi
    
    # MQL query for CPU utilization
    QUERY="CpuUtilization[1m]{resourceId = \"${instance_id}\"}.mean() > ${threshold}"
    
    oci monitoring alarm create \
        --compartment-id "$COMPARTMENT_ID" \
        --display-name "$alarm_name" \
        --metric-compartment-id "$COMPARTMENT_ID" \
        --namespace "oci_computeagent" \
        --query-text "$QUERY" \
        --severity "WARNING" \
        --destinations "[\"${TOPIC_ID}\"]" \
        --is-enabled true \
        --pending-duration "PT5M" \
        --body "High CPU utilization on ${instance_name}. Current value: {{value}}%" \
        2>/dev/null || log_warn "Failed to create CPU alarm for $instance_name"
    
    echo -e "  ${GREEN}✓${NC} Created alarm: $alarm_name"
}

create_health_alarm() {
    local instance_id="$1"
    local instance_name="$2"
    local alarm_name="${instance_name}-health"
    
    log_info "Creating health alarm for $instance_name..."
    
    EXISTING_ALARM=$(oci monitoring alarm list \
        --compartment-id "$COMPARTMENT_ID" \
        --display-name "$alarm_name" \
        --lifecycle-state ACTIVE \
        --query "data[0].id" \
        --raw-output 2>/dev/null || echo "null")
    
    if [ "$EXISTING_ALARM" != "null" ] && [ -n "$EXISTING_ALARM" ]; then
        log_warn "Alarm already exists, skipping..."
        return
    fi
    
    # MQL query for instance health (status != RUNNING)
    QUERY="instance_status[1m]{resourceId = \"${instance_id}\"}.mean() < 1"
    
    oci monitoring alarm create \
        --compartment-id "$COMPARTMENT_ID" \
        --display-name "$alarm_name" \
        --metric-compartment-id "$COMPARTMENT_ID" \
        --namespace "oci_compute_infrastructure_health" \
        --query-text "$QUERY" \
        --severity "CRITICAL" \
        --destinations "[\"${TOPIC_ID}\"]" \
        --is-enabled true \
        --pending-duration "PT2M" \
        --body "Instance ${instance_name} is not healthy or not running!" \
        2>/dev/null || log_warn "Failed to create health alarm for $instance_name"
    
    echo -e "  ${GREEN}✓${NC} Created alarm: $alarm_name"
}

# =============================================================================
# OUTPUT GENERATION
# =============================================================================

generate_output() {
    log_section "Infrastructure Output"
    
    # Generate JSON output file
    cat > "$OUTPUT_FILE" << EOF
{
  "created_at": "$(date -Iseconds)",
  "region": "$REGION",
  "compartment_id": "$COMPARTMENT_ID",
  "networking": {
    "vcn_id": "$VCN_ID",
    "vcn_name": "$VCN_NAME",
    "vcn_cidr": "$VCN_CIDR",
    "internet_gateway_id": "$IGW_ID",
    "route_table_id": "$RT_ID",
    "security_list_id": "$SL_ID",
    "subnet_id": "$SUBNET_ID",
    "subnet_cidr": "$SUBNET_CIDR"
  },
  "compute": {
    "workers": [
      {
        "instance_id": "$WORKER_1_VM_ID",
        "name": "${WORKER_VM_NAME}-1",
        "public_ip": "$WORKER_1_PUBLIC_IP",
        "shape": "$WORKER_SHAPE",
        "ocpus": $WORKER_OCPUS,
        "memory_gb": $WORKER_MEMORY_GB
      },
      {
        "instance_id": "$WORKER_2_VM_ID",
        "name": "${WORKER_VM_NAME}-2",
        "public_ip": "$WORKER_2_PUBLIC_IP",
        "shape": "$WORKER_SHAPE",
        "ocpus": $WORKER_OCPUS,
        "memory_gb": $WORKER_MEMORY_GB
      }
    ],
    "admin": {
      "instance_id": "$ADMIN_VM_ID",
      "name": "$ADMIN_VM_NAME",
      "public_ip": "$ADMIN_PUBLIC_IP",
      "shape": "$ADMIN_SHAPE",
      "ocpus": 0.125,
      "memory_gb": 1,
      "domain": "$ADMIN_DOMAIN"
    },
    "temporal": {
      "instance_id": "$TEMPORAL_VM_ID",
      "name": "$TEMPORAL_VM_NAME",
      "public_ip": "$TEMPORAL_PUBLIC_IP",
      "shape": "$TEMPORAL_SHAPE",
      "ocpus": $TEMPORAL_OCPUS,
      "memory_gb": $TEMPORAL_MEMORY_GB,
      "grpc_port": 7233,
      "ui_port": 8080
    }
  },
  "temporal": {
    "address": "${TEMPORAL_PUBLIC_IP}:7233",
    "ui_url": "http://${TEMPORAL_PUBLIC_IP}:8080",
    "internal_address": "${TEMPORAL_VM_NAME}.public.hnjobs.oraclevcn.com:7233"
  },
  "ssh": {
    "user": "deploy",
    "public_key_path": "$SSH_KEY_PATH",
    "repo_url": "$REPO_URL"
  },
  "free_tier_usage": {
    "arm_ocpus_used": $(( WORKER_OCPUS * WORKER_COUNT + TEMPORAL_OCPUS )),
    "arm_ocpus_total": 4,
    "arm_memory_used_gb": $(( WORKER_MEMORY_GB * WORKER_COUNT + TEMPORAL_MEMORY_GB )),
    "arm_memory_total_gb": 24,
    "amd_instances_used": 1,
    "amd_instances_total": 1
  },
  "monitoring": {
    "notification_topic_id": "${TOPIC_ID:-skipped}",
    "alarms": [
      "${WORKER_VM_NAME}-1-high-cpu",
      "${WORKER_VM_NAME}-1-health",
      "${WORKER_VM_NAME}-2-high-cpu",
      "${WORKER_VM_NAME}-2-health",
      "${ADMIN_VM_NAME}-high-cpu",
      "${ADMIN_VM_NAME}-health",
      "${TEMPORAL_VM_NAME}-high-cpu",
      "${TEMPORAL_VM_NAME}-health"
    ]
  },
  "logging": {
    "log_group_id": "${LOG_GROUP_ID:-skipped}",
    "logs": {
      "worker": "${WORKER_LOG_ID:-skipped}",
      "admin": "${ADMIN_LOG_ID:-skipped}",
      "caddy": "${CADDY_LOG_ID:-skipped}"
    },
    "agent_config_id": "${AGENT_CONFIG_ID:-manual-setup-required}"
  }
}
EOF
    
    log_success "Output saved to: $OUTPUT_FILE"
    echo ""
    cat "$OUTPUT_FILE" | jq .
    
    # Print Free Tier Usage Summary
    echo ""
    log_section "Free Tier Usage Summary"
    echo -e "┌─────────────────────────────────────────────────────────┐"
    echo -e "│ Resource           │ Used      │ Total    │ Remaining  │"
    echo -e "├─────────────────────────────────────────────────────────┤"
    echo -e "│ ARM OCPUs          │ $(( WORKER_OCPUS * WORKER_COUNT ))         │ 4        │ $(( 4 - WORKER_OCPUS * WORKER_COUNT ))          │"
    echo -e "│ ARM Memory (GB)    │ $(( WORKER_MEMORY_GB * WORKER_COUNT ))        │ 24       │ $(( 24 - WORKER_MEMORY_GB * WORKER_COUNT ))          │"
    echo -e "│ AMD Micro Instance │ 1         │ 1        │ 0          │"
    echo -e "└─────────────────────────────────────────────────────────┘"
    
    # Print GitHub Secrets
    echo ""
    log_section "GitHub Secrets Configuration"
    echo -e "Add these secrets to your GitHub repository settings:"
    echo ""
    echo -e "${BOLD}Oracle Cloud VMs:${NC}"
    echo -e "  ORACLE_WORKER_1_HOST   = ${CYAN}${WORKER_1_PUBLIC_IP}${NC}"
    echo -e "  ORACLE_WORKER_2_HOST   = ${CYAN}${WORKER_2_PUBLIC_IP}${NC}"
    echo -e "  ORACLE_WORKER_SSH_KEY  = ${CYAN}<contents of private key for ${SSH_KEY_PATH%.pub}>${NC}"
    echo -e "  ORACLE_ADMIN_HOST      = ${CYAN}${ADMIN_PUBLIC_IP}${NC}"
    echo -e "  ORACLE_ADMIN_SSH_KEY   = ${CYAN}<contents of private key for ${SSH_KEY_PATH%.pub}>${NC}"
    echo -e "  TEMPORAL_ADDRESS       = ${CYAN}${TEMPORAL_PUBLIC_IP}:7233${NC}"
    
    # Print SSH commands
    echo ""
    log_section "SSH Access"
    PRIVATE_KEY="${SSH_KEY_PATH%.pub}"
    echo -e "Connect to Worker VM 1:"
    echo -e "  ${CYAN}ssh -i $PRIVATE_KEY deploy@$WORKER_1_PUBLIC_IP${NC}"
    echo ""
    echo -e "Connect to Worker VM 2:"
    echo -e "  ${CYAN}ssh -i $PRIVATE_KEY deploy@$WORKER_2_PUBLIC_IP${NC}"
    echo ""
    echo -e "Connect to Admin VM:"
    echo -e "  ${CYAN}ssh -i $PRIVATE_KEY deploy@$ADMIN_PUBLIC_IP${NC}"
    echo ""
    echo -e "Connect to Temporal VM:"
    echo -e "  ${CYAN}ssh -i $PRIVATE_KEY deploy@$TEMPORAL_PUBLIC_IP${NC}"
    
    # Print DNS configuration
    echo ""
    log_section "DNS Configuration"
    echo -e "Add this A record to your DNS provider:"
    echo -e "  ${CYAN}${ADMIN_DOMAIN}  →  ${ADMIN_PUBLIC_IP}${NC}"
    echo ""
    echo -e "Once DNS propagates, Caddy will automatically obtain SSL certificate."
    
    # Print Temporal information
    echo ""
    log_section "Temporal Server"
    echo -e "Temporal gRPC:  ${CYAN}${TEMPORAL_PUBLIC_IP}:7233${NC}"
    echo -e "Temporal UI:    ${CYAN}http://${TEMPORAL_PUBLIC_IP}:8080${NC}"
    echo ""
    echo "Set this in your .env files:"
    echo -e "  ${CYAN}TEMPORAL_ADDRESS=${TEMPORAL_PUBLIC_IP}:7233${NC}"
    
    # Print next steps
    echo ""
    log_section "Next Steps"
    echo "1. Add the GitHub secrets shown above to your repository"
    echo "2. Configure DNS A record for ${ADMIN_DOMAIN} → ${ADMIN_PUBLIC_IP}"
    echo "3. Confirm the email subscription (check your inbox)"
    echo "4. Wait ~5-10 minutes for cloud-init to complete on all VMs"
    echo "   - Temporal VM takes longer due to Docker image pulls"
    echo "5. Verify Temporal is running:"
    echo -e "   ${CYAN}ssh -i $PRIVATE_KEY deploy@$TEMPORAL_PUBLIC_IP 'docker ps'${NC}"
    echo "   - Should show: temporal-server, temporal-ui, temporal-postgresql"
    echo "6. SSH into Worker/Admin VMs to verify setup:"
    echo "   - Check Bun: bun --version"
    echo "   - Check deploy user: id deploy"
    echo "7. Clone the repository to /opt/hnjobs on Worker/Admin VMs"
    echo "8. Create .env files with required secrets (including TEMPORAL_ADDRESS)"
    echo "9. Start the services:"
    echo "   - Worker VMs: sudo systemctl start hnjobs-worker"
    echo "   - Admin VM: sudo systemctl start hnjobs-admin"
    echo ""
    echo -e "${BOLD}Monitoring & Logging:${NC}"
    echo "  View metrics:  OCI Console → Observability → Monitoring → Metrics Explorer"
    echo "  View alarms:   OCI Console → Observability → Monitoring → Alarm Definitions"
    echo "  View logs:     OCI Console → Observability → Logging → Log Groups → ${PREFIX}-logs"
    echo "  Agent config:  OCI Console → Observability → Logging → Agent Configurations"
    echo "  Temporal UI:   http://${TEMPORAL_PUBLIC_IP}:8080"
    echo ""
    echo -e "${GREEN}${BOLD}Infrastructure setup complete!${NC}"
}

# =============================================================================
# MAIN
# =============================================================================

main() {
    echo ""
    echo -e "${BOLD}╔══════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}║       HN Jobs - Oracle Cloud Infrastructure Setup Script         ║${NC}"
    echo -e "${BOLD}╚══════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "This script will provision:"
    echo "  • VCN with public subnet and internet gateway"
    echo "  • Security lists for SSH, HTTP, HTTPS, Temporal gRPC access"
    echo "  • ${WORKER_COUNT}x Worker VMs (ARM A1.Flex, ${WORKER_OCPUS} OCPU, ${WORKER_MEMORY_GB}GB RAM each)"
    echo "  • 1x Temporal VM (ARM A1.Flex, ${TEMPORAL_OCPUS} OCPUs, ${TEMPORAL_MEMORY_GB}GB RAM) with PostgreSQL"
    echo "  • 1x Admin VM (AMD E2.1.Micro, 1/8 OCPU, 1GB RAM) with Caddy"
    echo "  • OCI Monitoring with CPU and health alarms"
    echo "  • OCI Logging for centralized log collection"
    echo ""
    echo -e "${YELLOW}Free Tier Usage:${NC}"
    local total_arm_ocpus=$(( WORKER_OCPUS * WORKER_COUNT + TEMPORAL_OCPUS ))
    local total_arm_memory=$(( WORKER_MEMORY_GB * WORKER_COUNT + TEMPORAL_MEMORY_GB ))
    echo "  ARM: ${total_arm_ocpus}/4 OCPUs, ${total_arm_memory}/24GB RAM"
    echo "  AMD: 1/1 Micro instance"
    echo ""
    
    if ! prompt_yes_no "Continue with infrastructure setup?" "y"; then
        log_info "Aborted by user."
        exit 0
    fi
    
    # Run setup phases
    preflight_checks
    gather_configuration
    check_existing_resources
    setup_networking
    provision_compute
    setup_monitoring
    generate_output
}

check_existing_resources() {
    log_section "Checking Existing Resources"
    
    local existing_count=0
    
    # Check VCN
    local vcn=""
    vcn=$(oci network vcn list --compartment-id "$COMPARTMENT_ID" --display-name "$VCN_NAME" --query "data[0].id" --raw-output 2>/dev/null) || vcn=""
    if [ -n "$vcn" ] && [ "$vcn" != "null" ]; then
        echo -e "  ${GREEN}✓${NC} VCN: ${VCN_NAME} (exists)"
        existing_count=$((existing_count + 1))
    else
        echo -e "  ${YELLOW}○${NC} VCN: ${VCN_NAME} (will create)"
    fi
    
    # Check Worker VMs
    for i in $(seq 1 $WORKER_COUNT); do
        local worker_name="${WORKER_VM_NAME}-${i}"
        local vm=""
        vm=$(oci compute instance list --compartment-id "$COMPARTMENT_ID" --display-name "$worker_name" --lifecycle-state RUNNING --query "data[0].id" --raw-output 2>/dev/null) || vm=""
        if [ -n "$vm" ] && [ "$vm" != "null" ]; then
            echo -e "  ${GREEN}✓${NC} Worker VM $i: ${worker_name} (exists)"
            existing_count=$((existing_count + 1))
        else
            echo -e "  ${YELLOW}○${NC} Worker VM $i: ${worker_name} (will create)"
        fi
    done
    
    # Check Admin VM
    local admin=""
    admin=$(oci compute instance list --compartment-id "$COMPARTMENT_ID" --display-name "$ADMIN_VM_NAME" --lifecycle-state RUNNING --query "data[0].id" --raw-output 2>/dev/null) || admin=""
    if [ -n "$admin" ] && [ "$admin" != "null" ]; then
        echo -e "  ${GREEN}✓${NC} Admin VM: ${ADMIN_VM_NAME} (exists)"
        existing_count=$((existing_count + 1))
    else
        echo -e "  ${YELLOW}○${NC} Admin VM: ${ADMIN_VM_NAME} (will create)"
    fi
    
    # Check Temporal VM
    local temporal=""
    temporal=$(oci compute instance list --compartment-id "$COMPARTMENT_ID" --display-name "$TEMPORAL_VM_NAME" --lifecycle-state RUNNING --query "data[0].id" --raw-output 2>/dev/null) || temporal=""
    if [ -n "$temporal" ] && [ "$temporal" != "null" ]; then
        echo -e "  ${GREEN}✓${NC} Temporal VM: ${TEMPORAL_VM_NAME} (exists)"
        existing_count=$((existing_count + 1))
    else
        echo -e "  ${YELLOW}○${NC} Temporal VM: ${TEMPORAL_VM_NAME} (will create)"
    fi
    
    # Check Monitoring
    local topic=""
    topic=$(oci ons topic list --compartment-id "$COMPARTMENT_ID" --name "${PREFIX}-alerts" --lifecycle-state ACTIVE --query "data[0].\"topic-id\"" --raw-output 2>/dev/null) || topic=""
    if [ -n "$topic" ] && [ "$topic" != "null" ]; then
        echo -e "  ${GREEN}✓${NC} Notification Topic: ${PREFIX}-alerts (exists)"
        existing_count=$((existing_count + 1))
    else
        echo -e "  ${YELLOW}○${NC} Notification Topic: ${PREFIX}-alerts (will create)"
    fi
    
    echo ""
    if [ $existing_count -gt 0 ]; then
        log_info "Found $existing_count existing resources. Script will reuse them."
        echo ""
        if ! prompt_yes_no "Continue? (Existing resources will be reused, missing ones created)" "y"; then
            log_info "Aborted by user."
            exit 0
        fi
    fi
}

# Run main function
main "$@"
