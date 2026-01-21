#!/usr/bin/env bash
#
# OCI Infrastructure Audit Script for HN Jobs
# 
# Lists all existing OCI resources for the HN Jobs project.
# Use this to see what's been provisioned and their current status.
#
# Usage: ./scripts/oci-audit.sh [compartment-id]
#
set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'
DIM='\033[2m'

PREFIX="hnjobs"

log_section() {
    echo ""
    echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${BOLD}${CYAN}  $1${NC}"
    echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    echo ""
}

# Get compartment ID
if [ -n "${1:-}" ]; then
    COMPARTMENT_ID="$1"
else
    # Try to get from existing infra-output.json
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [ -f "${SCRIPT_DIR}/infra-output.json" ]; then
        COMPARTMENT_ID=$(jq -r '.compartment_id // empty' "${SCRIPT_DIR}/infra-output.json" 2>/dev/null || echo "")
    fi
    
    if [ -z "$COMPARTMENT_ID" ]; then
        echo -e "${YELLOW}Usage: $0 <compartment-id>${NC}"
        echo ""
        echo "Available compartments:"
        oci iam compartment list --compartment-id-in-subtree true --all \
            --query "data[?\"lifecycle-state\"=='ACTIVE'].{Name:name, OCID:id}" \
            --output table 2>/dev/null || echo "  (unable to list compartments)"
        exit 1
    fi
fi

echo ""
echo -e "${BOLD}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║         HN Jobs - OCI Infrastructure Audit                    ║${NC}"
echo -e "${BOLD}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "Compartment: ${CYAN}${COMPARTMENT_ID}${NC}"
echo -e "Timestamp:   ${CYAN}$(date -Iseconds)${NC}"

# ============================================================================
# NETWORKING
# ============================================================================
log_section "Networking Resources"

echo -e "${BOLD}VCNs:${NC}"
vcns=$(oci network vcn list --compartment-id "$COMPARTMENT_ID" \
    --query "data[?contains(\"display-name\", '$PREFIX')].{Name:\"display-name\", State:\"lifecycle-state\", CIDR:\"cidr-block\", OCID:id}" \
    --output json 2>/dev/null || echo "[]")

if [ "$vcns" = "[]" ]; then
    echo -e "  ${DIM}No VCNs found${NC}"
else
    echo "$vcns" | jq -r '.[] | "  \(.State | if . == "AVAILABLE" then "✓" else "○" end) \(.Name) [\(.State)] - \(.CIDR)\n    OCID: \(.OCID)"'
fi

echo ""
echo -e "${BOLD}Subnets:${NC}"
subnets=$(oci network subnet list --compartment-id "$COMPARTMENT_ID" \
    --query "data[?contains(\"display-name\", '$PREFIX')].{Name:\"display-name\", State:\"lifecycle-state\", CIDR:\"cidr-block\", Public:\"prohibit-public-ip-on-vnic\"}" \
    --output json 2>/dev/null || echo "[]")

if [ "$subnets" = "[]" ]; then
    echo -e "  ${DIM}No subnets found${NC}"
else
    echo "$subnets" | jq -r '.[] | "  \(.State | if . == "AVAILABLE" then "✓" else "○" end) \(.Name) [\(.State)] - \(.CIDR) \(if .Public == false then "(public)" else "(private)" end)"'
fi

echo ""
echo -e "${BOLD}Internet Gateways:${NC}"
igws=$(oci network internet-gateway list --compartment-id "$COMPARTMENT_ID" \
    --query "data[?contains(\"display-name\", '$PREFIX')].{Name:\"display-name\", State:\"lifecycle-state\", Enabled:\"is-enabled\"}" \
    --output json 2>/dev/null || echo "[]")

if [ "$igws" = "[]" ]; then
    echo -e "  ${DIM}No internet gateways found${NC}"
else
    echo "$igws" | jq -r '.[] | "  \(.State | if . == "AVAILABLE" then "✓" else "○" end) \(.Name) [\(.State)] \(if .Enabled then "(enabled)" else "(disabled)" end)"'
fi

# ============================================================================
# COMPUTE
# ============================================================================
log_section "Compute Instances"

instances=$(oci compute instance list --compartment-id "$COMPARTMENT_ID" \
    --query "data[?contains(\"display-name\", '$PREFIX')].{Name:\"display-name\", State:\"lifecycle-state\", Shape:shape, OCID:id, AD:\"availability-domain\"}" \
    --output json 2>/dev/null || echo "[]")

# Handle null or empty response
if [ -z "$instances" ] || [ "$instances" = "null" ]; then
    instances="[]"
fi

if [ "$instances" = "[]" ]; then
    echo -e "  ${DIM}No compute instances found${NC}"
else
    # Group by state
    running=$(echo "$instances" | jq '[.[] | select(.State == "RUNNING")]' 2>/dev/null || echo "[]")
    stopped=$(echo "$instances" | jq '[.[] | select(.State == "STOPPED")]' 2>/dev/null || echo "[]")
    other=$(echo "$instances" | jq '[.[] | select(.State != "RUNNING" and .State != "STOPPED" and .State != "TERMINATED")]' 2>/dev/null || echo "[]")
    
    running_len=$(echo "$running" | jq 'length' 2>/dev/null || echo "0")
    if [ "$running_len" -gt 0 ]; then
        echo -e "${GREEN}Running:${NC}"
        echo "$running" | jq -r '.[] | "  ✓ \(.Name) - \(.Shape)\n    OCID: \(.OCID)"'
        
        # Get public IPs for running instances
        echo ""
        echo -e "${BOLD}Public IPs:${NC}"
        for ocid in $(echo "$running" | jq -r '.[].OCID'); do
            name=$(echo "$running" | jq -r ".[] | select(.OCID == \"$ocid\") | .Name")
            vnic_id=$(oci compute vnic-attachment list --compartment-id "$COMPARTMENT_ID" --instance-id "$ocid" \
                --query "data[0].\"vnic-id\"" --raw-output 2>/dev/null || echo "")
            if [ -n "$vnic_id" ] && [ "$vnic_id" != "null" ]; then
                public_ip=$(oci network vnic get --vnic-id "$vnic_id" \
                    --query "data.\"public-ip\"" --raw-output 2>/dev/null || echo "N/A")
                private_ip=$(oci network vnic get --vnic-id "$vnic_id" \
                    --query "data.\"private-ip\"" --raw-output 2>/dev/null || echo "N/A")
                echo -e "  ${name}: ${CYAN}${public_ip:-N/A}${NC} (private: ${private_ip:-N/A})"
            fi
        done
    fi
    
    stopped_len=$(echo "$stopped" | jq 'length' 2>/dev/null || echo "0")
    if [ "$stopped_len" -gt 0 ]; then
        echo ""
        echo -e "${YELLOW}Stopped:${NC}"
        echo "$stopped" | jq -r '.[] | "  ○ \(.Name) - \(.Shape)\n    OCID: \(.OCID)"'
    fi
    
    other_len=$(echo "$other" | jq 'length' 2>/dev/null || echo "0")
    if [ "$other_len" -gt 0 ]; then
        echo ""
        echo -e "${RED}Other States:${NC}"
        echo "$other" | jq -r '.[] | "  ? \(.Name) [\(.State)] - \(.Shape)"'
    fi
fi

# ============================================================================
# MONITORING & LOGGING
# ============================================================================
log_section "Monitoring & Logging"

echo -e "${BOLD}Notification Topics:${NC}"
topics=$(oci ons topic list --compartment-id "$COMPARTMENT_ID" \
    --query "data[?contains(name, '$PREFIX')].{Name:name, State:\"lifecycle-state\", TopicId:\"topic-id\"}" \
    --output json 2>/dev/null || echo "[]")

if [ -z "$topics" ] || [ "$topics" = "null" ]; then
    topics="[]"
fi

if [ "$topics" = "[]" ]; then
    echo -e "  ${DIM}No notification topics found${NC}"
else
    echo "$topics" | jq -r '.[] | "  \(.State | if . == "ACTIVE" then "✓" else "○" end) \(.Name) [\(.State)]"' 2>/dev/null || echo -e "  ${DIM}No notification topics found${NC}"
fi

echo ""
echo -e "${BOLD}Log Groups:${NC}"
log_groups=$(oci logging log-group list --compartment-id "$COMPARTMENT_ID" \
    --query "data[?contains(\"display-name\", '$PREFIX')].{Name:\"display-name\", OCID:id}" \
    --output json 2>/dev/null || echo "[]")

if [ -z "$log_groups" ] || [ "$log_groups" = "null" ]; then
    log_groups="[]"
fi

if [ "$log_groups" = "[]" ]; then
    echo -e "  ${DIM}No log groups found${NC}"
else
    for lg in $(echo "$log_groups" | jq -r '.[].OCID' 2>/dev/null); do
        lg_name=$(echo "$log_groups" | jq -r ".[] | select(.OCID == \"$lg\") | .Name" 2>/dev/null)
        echo -e "  ✓ ${lg_name}"
        
        # List logs in this group
        logs=$(oci logging log list --log-group-id "$lg" \
            --query "data[].{Name:\"display-name\", State:\"lifecycle-state\"}" \
            --output json 2>/dev/null || echo "[]")
        if [ -n "$logs" ] && [ "$logs" != "[]" ] && [ "$logs" != "null" ]; then
            echo "$logs" | jq -r '.[] | "    └─ \(.Name) [\(.State)]"' 2>/dev/null || true
        fi
    done
fi

echo ""
echo -e "${BOLD}Alarms:${NC}"
alarms=$(oci monitoring alarm list --compartment-id "$COMPARTMENT_ID" \
    --query "data[?contains(\"display-name\", '$PREFIX')].{Name:\"display-name\", State:\"lifecycle-state\", Enabled:\"is-enabled\", Severity:severity}" \
    --output json 2>/dev/null || echo "[]")

if [ -z "$alarms" ] || [ "$alarms" = "null" ]; then
    alarms="[]"
fi

if [ "$alarms" = "[]" ]; then
    echo -e "  ${DIM}No alarms found${NC}"
else
    echo "$alarms" | jq -r '.[] | "  \(if .Enabled then "✓" else "○" end) \(.Name) [\(.Severity)] - \(.State)"' 2>/dev/null || echo -e "  ${DIM}No alarms found${NC}"
fi

echo ""
echo -e "${BOLD}Agent Configurations:${NC}"
agent_configs=$(oci logging agent-configuration list --compartment-id "$COMPARTMENT_ID" \
    --query "data[?contains(\"display-name\", '$PREFIX')].{Name:\"display-name\", State:\"lifecycle-state\"}" \
    --output json 2>/dev/null || echo "[]")

if [ -z "$agent_configs" ] || [ "$agent_configs" = "null" ]; then
    agent_configs="[]"
fi

if [ "$agent_configs" = "[]" ]; then
    echo -e "  ${DIM}No agent configurations found${NC}"
else
    echo "$agent_configs" | jq -r '.[] | "  \(.State | if . == "ACTIVE" then "✓" else "○" end) \(.Name) [\(.State)]"' 2>/dev/null || echo -e "  ${DIM}No agent configurations found${NC}"
fi

# ============================================================================
# SUMMARY
# ============================================================================
log_section "Summary"

vcn_count=$(echo "$vcns" | jq 'length' 2>/dev/null || echo "0")
subnet_count=$(echo "$subnets" | jq 'length' 2>/dev/null || echo "0")
instance_count=$(echo "$instances" | jq 'length' 2>/dev/null || echo "0")
running_count=$(echo "$instances" | jq '[.[] | select(.State == "RUNNING")] | length' 2>/dev/null || echo "0")
alarm_count=$(echo "$alarms" | jq 'length' 2>/dev/null || echo "0")

# Ensure we have valid numbers
vcn_count=${vcn_count:-0}
subnet_count=${subnet_count:-0}
instance_count=${instance_count:-0}
running_count=${running_count:-0}
alarm_count=${alarm_count:-0}

echo -e "┌────────────────────────────────────────┐"
echo -e "│ Resource Type          │ Count        │"
echo -e "├────────────────────────────────────────┤"
printf "│ VCNs                   │ %-12s │\n" "$vcn_count"
printf "│ Subnets                │ %-12s │\n" "$subnet_count"
printf "│ Compute Instances      │ %-12s │\n" "$instance_count"
printf "│   └─ Running           │ %-12s │\n" "$running_count"
printf "│ Alarms                 │ %-12s │\n" "$alarm_count"
echo -e "└────────────────────────────────────────┘"

# Free tier usage
if [ "$running_count" -gt 0 ] 2>/dev/null; then
    echo ""
    echo -e "${BOLD}Free Tier Usage Estimate:${NC}"
    
    arm_instances=$(echo "$instances" | jq '[.[] | select(.State == "RUNNING" and (.Shape | contains("A1")))]' 2>/dev/null || echo "[]")
    amd_instances=$(echo "$instances" | jq '[.[] | select(.State == "RUNNING" and (.Shape | contains("E2.1.Micro")))]' 2>/dev/null || echo "[]")
    
    arm_count=$(echo "$arm_instances" | jq 'length' 2>/dev/null || echo "0")
    amd_count=$(echo "$amd_instances" | jq 'length' 2>/dev/null || echo "0")
    
    echo -e "  ARM A1.Flex instances: ${arm_count:-0} (max 4 OCPUs / 24GB total)"
    echo -e "  AMD E2.1.Micro instances: ${amd_count:-0}/1"
fi

echo ""
echo -e "${GREEN}Audit complete!${NC}"
