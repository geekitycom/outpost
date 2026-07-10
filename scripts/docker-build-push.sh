#!/bin/bash

# Docker Build and Push Script for outpost
# Builds and pushes a multi-platform image to the GitHub Container Registry
# (ghcr.io/geekitycom/outpost). Version comes from package.json.

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DOCKER_REPO="ghcr.io/geekitycom/outpost"
DOCKERFILE_PATH="Dockerfile"

# Helper functions
log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

show_usage() {
    echo "Usage: $0 [OPTIONS] [CUSTOM_TAG]"
    echo ""
    echo "Options:"
    echo "  --dry-run         Show what would be done without executing"
    echo "  -h, --help        Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                # Build and push with version + latest tags"
    echo "  $0 beta           # Build and push with version + latest + beta tags"
    echo "  $0 --dry-run      # Show what the build would do, without executing"
    echo ""
}

# Parse command line arguments
CUSTOM_TAG=""
DRY_RUN=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_usage
            exit 0
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        *)
            CUSTOM_TAG="$1"
            shift
            ;;
    esac
done

# Function to check if Docker is running
check_docker() {
    log_info "Checking if Docker is running..."
    if ! docker info >/dev/null 2>&1; then
        log_error "Docker is not running. Please start Docker and try again."
        exit 1
    fi
    log_success "Docker is running"
}

# Function to check GitHub Container Registry login
check_docker_login() {
    log_info "Checking GitHub Container Registry authentication..."
    if ! grep -q '"ghcr.io"' "$HOME/.docker/config.json" 2>/dev/null; then
        log_warning "Not logged into ghcr.io. Attempting login..."
        if ! docker login ghcr.io; then
            log_error "Failed to login to ghcr.io. Please run 'docker login ghcr.io' manually."
            exit 1
        fi
    fi
    log_success "ghcr.io authentication verified"
}

# Function to run quality checks
run_quality_checks() {
    log_info "Running quality checks..."

    log_info "Running TypeScript type checking..."
    if ! pnpm typecheck; then
        log_error "TypeScript type checking failed"
        exit 1
    fi

    log_info "Running ESLint..."
    if ! pnpm lint; then
        log_error "ESLint checks failed"
        exit 1
    fi

    log_info "Running tests..."
    if ! pnpm test; then
        log_error "Tests failed"
        exit 1
    fi

    log_success "All quality checks passed"
}

# Function to get version from package.json
get_version() {
    node -p "require('./package.json').version"
}

# Function to build (and push) the multi-platform Docker image
build_image() {
    local version=$(get_version)

    log_info "Building Docker image..."
    log_info "Version: $version"

    if [ "$DRY_RUN" = true ]; then
        log_info "[DRY RUN] Would build image with tag: ${DOCKER_REPO}:${version}"
        log_info "[DRY RUN] Would tag as latest: ${DOCKER_REPO}:latest"
        if [ -n "$CUSTOM_TAG" ]; then
            log_info "[DRY RUN] Would tag with custom tag: ${DOCKER_REPO}:${CUSTOM_TAG}"
        fi
        log_success "[DRY RUN] Docker image build simulation completed"
        return 0
    fi

    log_info "Building multi-platform image with tag: ${DOCKER_REPO}:${version}"
    log_info "Building for platforms: linux/amd64,linux/arm64"

    # Create buildx builder if it doesn't exist
    if ! docker buildx ls | grep -q multiplatform; then
        log_info "Creating multiplatform buildx builder..."
        docker buildx create --name multiplatform --use
    else
        docker buildx use multiplatform
    fi

    # Build all tags at once
    local tags="-t ${DOCKER_REPO}:${version} -t ${DOCKER_REPO}:latest"
    if [ -n "$CUSTOM_TAG" ]; then
        tags="$tags -t ${DOCKER_REPO}:${CUSTOM_TAG}"
    fi

    # Build and push multi-platform image with all tags.
    # Using --no-cache to ensure fresh builds.
    if ! docker buildx build -f "$DOCKERFILE_PATH" \
        --platform linux/amd64,linux/arm64 \
        $tags \
        --no-cache \
        --push .; then
        log_error "Docker multi-platform build failed"
        exit 1
    fi

    log_success "Docker image built and pushed successfully"
}

# Function to display image info
show_image_info() {
    local version=$(get_version)

    echo ""
    log_success "🐳 Docker image build and push completed!"
    echo ""
    echo "📦 Image Repository: ${DOCKER_REPO}"
    echo "🏷️  Tags pushed:"
    echo "   • ${DOCKER_REPO}:${version}"
    echo "   • ${DOCKER_REPO}:latest"
    if [ -n "$CUSTOM_TAG" ]; then
        echo "   • ${DOCKER_REPO}:${CUSTOM_TAG}"
    fi
    echo ""
    echo "🚀 To run the image:"
    echo "   docker run -d -p 127.0.0.1:3000:3000 \\"
    echo "     -v ./domains:/domains \\"
    echo "     ${DOCKER_REPO}:latest"
    echo ""
}

# Main execution
main() {
    echo "🐳 outpost Docker Build & Push Script"
    echo "======================================"
    echo ""

    # Verify we're in the right directory
    if [ ! -f "package.json" ] || [ ! -f "$DOCKERFILE_PATH" ]; then
        log_error "Please run this script from the project root directory"
        exit 1
    fi

    # Run all checks and build steps
    check_docker
    check_docker_login
    run_quality_checks
    build_image
    show_image_info
}

# Run main function with all arguments
main "$@"
