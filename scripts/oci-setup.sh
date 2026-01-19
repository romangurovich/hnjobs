#!/usr/bin/env bash
#
# OCI Infrastructure Setup Script for HN Jobs
# 
# This script provisions the complete Oracle Cloud infrastructure:
# - VCN with public subnet
# - Internet Gateway and routing
# - Security lists for SSH, HTTP, HTTPS
# - Two ARM A1.Flex VMs (Worker + Admin) using Always Free tier
# - Cloud-init for automated setup (Bun, deploy user, Caddy)
#
# Usage: ./scripts/oci-setup.sh
#
set -euo pipefail

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

# Network configuration
VCN_CIDR="10.0.0.0/16"
SUBNET_CIDR="10.0.1.0/24"

# VM configuration (Always Free tier - splitting 4 OCPUs / 24GB RAM)
VM_SHAPE="VM.Standard.A1.Flex"
WORKER_OCPUS=2
WORKER_MEMORY_GB=12
ADMIN_OCPUS=2
ADMIN_MEMORY_GB=12
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
        # Ingress rules: SSH (22), HTTP (80), HTTPS (443)
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

get_arm_image() {
    log_info "Finding latest Oracle Linux ARM image..."
    
    # Get the latest Oracle Linux 8 ARM image
    IMAGE_ID=$(oci compute image list \
        --compartment-id "$COMPARTMENT_ID" \
        --operating-system "Oracle Linux" \
        --operating-system-version "8" \
        --shape "$VM_SHAPE" \
        --sort-by TIMECREATED \
        --sort-order DESC \
        --query "data[0].id" \
        --raw-output 2>/dev/null)
    
    if [ -z "$IMAGE_ID" ] || [ "$IMAGE_ID" = "null" ]; then
        log_error "Could not find Oracle Linux ARM image"
        exit 1
    fi
    
    IMAGE_NAME=$(oci compute image get \
        --image-id "$IMAGE_ID" \
        --query "data.\"display-name\"" \
        --raw-output 2>/dev/null)
    
    log_success "Found image: $IMAGE_NAME"
    echo -e "    Image OCID: ${CYAN}${IMAGE_ID}${NC}"
}

get_availability_domain() {
    AD=$(oci iam availability-domain list \
        --compartment-id "$COMPARTMENT_ID" \
        --query "data[0].name" \
        --raw-output 2>/dev/null)
    log_info "Using Availability Domain: $AD"
}

generate_cloud_init() {
    local vm_type="$1"
    local template_file="${CLOUD_INIT_DIR}/${vm_type}-init.yaml"
    local output_file="/tmp/${vm_type}-init-generated.yaml"
    
    # Substitute variables in template
    sed -e "s|\${SSH_PUBLIC_KEY}|${SSH_PUBLIC_KEY}|g" \
        -e "s|\${ADMIN_DOMAIN}|${ADMIN_DOMAIN}|g" \
        "$template_file" > "$output_file"
    
    echo "$output_file"
}

create_vm() {
    local vm_name="$1"
    local vm_type="$2"
    local ocpus="$3"
    local memory_gb="$4"
    
    log_info "Creating VM: $vm_name ($vm_type)..."
    log_info "  Shape: $VM_SHAPE | OCPUs: $ocpus | Memory: ${memory_gb}GB | Boot: ${BOOT_VOLUME_SIZE_GB}GB"
    
    # Check if VM already exists
    EXISTING_VM=$(oci compute instance list \
        --compartment-id "$COMPARTMENT_ID" \
        --display-name "$vm_name" \
        --lifecycle-state RUNNING \
        --query "data[0].id" \
        --raw-output 2>/dev/null || echo "null")
    
    if [ "$EXISTING_VM" != "null" ] && [ -n "$EXISTING_VM" ]; then
        log_warn "VM already exists, reusing..."
        echo "$EXISTING_VM"
        return
    fi
    
    # Generate cloud-init
    CLOUD_INIT_FILE=$(generate_cloud_init "$vm_type")
    CLOUD_INIT_BASE64=$(base64 -w 0 "$CLOUD_INIT_FILE")
    
    # Shape config for Flex shapes
    SHAPE_CONFIG="{\"ocpus\": $ocpus, \"memoryInGBs\": $memory_gb}"
    
    # Create the instance
    VM_RESULT=$(oci compute instance launch \
        --compartment-id "$COMPARTMENT_ID" \
        --availability-domain "$AD" \
        --display-name "$vm_name" \
        --shape "$VM_SHAPE" \
        --shape-config "$SHAPE_CONFIG" \
        --image-id "$IMAGE_ID" \
        --subnet-id "$SUBNET_ID" \
        --assign-public-ip true \
        --boot-volume-size-in-gbs "$BOOT_VOLUME_SIZE_GB" \
        --metadata "{\"user_data\": \"$CLOUD_INIT_BASE64\"}" \
        --wait-for-state RUNNING \
        --query "data" \
        2>/dev/null)
    
    VM_ID=$(echo "$VM_RESULT" | jq -r '.id')
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
    
    # Get ARM image
    get_arm_image
    
    # Get availability domain
    get_availability_domain
    
    echo ""
    
    # Create Worker VM
    WORKER_VM_ID=$(create_vm "$WORKER_VM_NAME" "worker" "$WORKER_OCPUS" "$WORKER_MEMORY_GB")
    print_resource "Worker VM" "$WORKER_VM_NAME" "$WORKER_VM_ID"
    
    # Create Admin VM
    ADMIN_VM_ID=$(create_vm "$ADMIN_VM_NAME" "admin" "$ADMIN_OCPUS" "$ADMIN_MEMORY_GB")
    print_resource "Admin VM" "$ADMIN_VM_NAME" "$ADMIN_VM_ID"
    
    # Wait and get public IPs
    log_info "Waiting for public IPs to be assigned..."
    sleep 10
    
    WORKER_PUBLIC_IP=$(get_vm_public_ip "$WORKER_VM_ID")
    ADMIN_PUBLIC_IP=$(get_vm_public_ip "$ADMIN_VM_ID")
    
    echo ""
    echo -e "  ${GREEN}✓${NC} Worker VM Public IP: ${BOLD}${WORKER_PUBLIC_IP}${NC}"
    echo -e "  ${GREEN}✓${NC} Admin VM Public IP:  ${BOLD}${ADMIN_PUBLIC_IP}${NC}"
    
    log_success "Compute provisioning complete!"
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
    "worker": {
      "instance_id": "$WORKER_VM_ID",
      "name": "$WORKER_VM_NAME",
      "public_ip": "$WORKER_PUBLIC_IP",
      "shape": "$VM_SHAPE",
      "ocpus": $WORKER_OCPUS,
      "memory_gb": $WORKER_MEMORY_GB
    },
    "admin": {
      "instance_id": "$ADMIN_VM_ID",
      "name": "$ADMIN_VM_NAME",
      "public_ip": "$ADMIN_PUBLIC_IP",
      "shape": "$VM_SHAPE",
      "ocpus": $ADMIN_OCPUS,
      "memory_gb": $ADMIN_MEMORY_GB,
      "domain": "$ADMIN_DOMAIN"
    }
  },
  "ssh": {
    "user": "deploy",
    "public_key_path": "$SSH_KEY_PATH"
  }
}
EOF
    
    log_success "Output saved to: $OUTPUT_FILE"
    echo ""
    cat "$OUTPUT_FILE" | jq .
    
    # Print GitHub Secrets
    echo ""
    log_section "GitHub Secrets Configuration"
    echo -e "Add these secrets to your GitHub repository settings:"
    echo ""
    echo -e "${BOLD}Oracle Cloud VMs:${NC}"
    echo -e "  ORACLE_WORKER_HOST     = ${CYAN}${WORKER_PUBLIC_IP}${NC}"
    echo -e "  ORACLE_WORKER_SSH_KEY  = ${CYAN}<contents of private key for ${SSH_KEY_PATH%.pub}>${NC}"
    echo -e "  ORACLE_ADMIN_HOST      = ${CYAN}${ADMIN_PUBLIC_IP}${NC}"
    echo -e "  ORACLE_ADMIN_SSH_KEY   = ${CYAN}<contents of private key for ${SSH_KEY_PATH%.pub}>${NC}"
    
    # Print SSH commands
    echo ""
    log_section "SSH Access"
    PRIVATE_KEY="${SSH_KEY_PATH%.pub}"
    echo -e "Connect to Worker VM:"
    echo -e "  ${CYAN}ssh -i $PRIVATE_KEY deploy@$WORKER_PUBLIC_IP${NC}"
    echo ""
    echo -e "Connect to Admin VM:"
    echo -e "  ${CYAN}ssh -i $PRIVATE_KEY deploy@$ADMIN_PUBLIC_IP${NC}"
    
    # Print DNS configuration
    echo ""
    log_section "DNS Configuration"
    echo -e "Add this A record to your DNS provider:"
    echo -e "  ${CYAN}${ADMIN_DOMAIN}  →  ${ADMIN_PUBLIC_IP}${NC}"
    echo ""
    echo -e "Once DNS propagates, Caddy will automatically obtain SSL certificate."
    
    # Print next steps
    echo ""
    log_section "Next Steps"
    echo "1. Add the GitHub secrets shown above to your repository"
    echo "2. Configure DNS A record for ${ADMIN_DOMAIN} → ${ADMIN_PUBLIC_IP}"
    echo "3. Wait ~5 minutes for cloud-init to complete on both VMs"
    echo "4. SSH into VMs to verify setup:"
    echo "   - Check Bun: bun --version"
    echo "   - Check deploy user: id deploy"
    echo "   - Check services: sudo systemctl status hnjobs-worker (or hnjobs-admin)"
    echo "5. Clone the repository to /opt/hnjobs on each VM"
    echo "6. Create .env files with required secrets"
    echo "7. Start the services: sudo systemctl start hnjobs-worker"
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
    echo "  • Security lists for SSH, HTTP, HTTPS access"
    echo "  • Worker VM (ARM A1.Flex, ${WORKER_OCPUS} OCPU, ${WORKER_MEMORY_GB}GB RAM)"
    echo "  • Admin VM (ARM A1.Flex, ${ADMIN_OCPUS} OCPU, ${ADMIN_MEMORY_GB}GB RAM) with Caddy"
    echo ""
    echo -e "${YELLOW}This uses Oracle Cloud Always Free tier resources.${NC}"
    echo ""
    
    if ! prompt_yes_no "Continue with infrastructure setup?" "y"; then
        log_info "Aborted by user."
        exit 0
    fi
    
    # Run setup phases
    preflight_checks
    gather_configuration
    setup_networking
    provision_compute
    generate_output
}

# Run main function
main "$@"
