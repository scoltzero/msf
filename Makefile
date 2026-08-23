.PHONY: dev build frontend import-web package release-package release-assets checksums verify-release-source verify-release-assets unraid fnos test test-dns-fixture test-e2e-ipv6 audit-compliance macos-app-project macos-app-test macos-app-build macos-app-build-debug macos-app-build-release macos-app-build-release-assets macos-app-build-signed macos-app-verify macos-release-assets macos-release-assets-signed macos-app-open clean

APP_NAME := msf
DIST := dist
WEB_EXPORT ?= msf_html_export.tar.gz
VERSION ?= 0.1.0-dev
UNRAID_VERSION ?= $(VERSION)
GITHUB_REPO ?= scoltzero/msf
RELEASE_TAG ?= v$(VERSION)
GOOS ?= linux
GOARCH ?= amd64
BIN := $(DIST)/$(APP_NAME)-$(GOOS)-$(GOARCH)
PACKAGE_DIR := $(DIST)/$(APP_NAME)-$(VERSION)-$(GOOS)-$(GOARCH)
MACOS_APP_DIR := macos/MSFMenuBar
XCODE_DEVELOPER_DIR ?= /Applications/Xcode.app/Contents/Developer
MACOS_CONFIGURATION ?= Debug
MACOS_BUILD_NUMBER ?= 1
MACOS_DEVELOPMENT_TEAM ?=
MACOS_SIGNING_IDENTITY ?=
MACOS_NOTARY_PROFILE ?=
MACOS_RELEASE_DIR ?= $(DIST)/macos

GIT_COMMIT := $(shell git rev-parse HEAD 2>/dev/null || printf unknown)
SOURCE_COMMIT ?= $(GIT_COMMIT)
BUILD_TAG ?= $(RELEASE_TAG)
TAG_COMMIT := $(shell git rev-parse --verify '$(RELEASE_TAG)^{commit}' 2>/dev/null || printf unknown)
BUILD_DIRTY := $(shell test -z "$$(git status --porcelain 2>/dev/null)" && printf false || printf true)
BUILD_TIME ?= $(shell date -u +%Y-%m-%dT%H:%M:%SZ)
LDFLAGS := -s -w \
	-X main.version=$(VERSION) \
	-X main.buildCommit=$(GIT_COMMIT) \
	-X main.buildTag=$(BUILD_TAG) \
	-X main.buildTagCommit=$(TAG_COMMIT) \
	-X main.buildSourceCommit=$(SOURCE_COMMIT) \
	-X main.buildDirty=$(BUILD_DIRTY) \
	-X main.buildTime=$(BUILD_TIME)

frontend:
	cd web && npm ci && npm run build

import-web:
	@tmp=$$(mktemp -d); \
	tar -xzf "$(WEB_EXPORT)" -C "$$tmp"; \
	src=$$(find "$$tmp" -type f -name index.raw.html -print -quit | xargs dirname); \
	test -n "$$src"; \
	rm -rf internal/server/web/dist; \
	mkdir -p internal/server/web/dist; \
	cp "$$src/index.raw.html" internal/server/web/dist/index.html; \
	for name in assets logo pages offline_pages dashboard_preview.png manifest.json; do \
		if [ -e "$$src/$$name" ]; then cp -R "$$src/$$name" internal/server/web/dist/; fi; \
	done; \
	if [ -f internal/server/web/dist/manifest.json ]; then mv internal/server/web/dist/manifest.json internal/server/web/dist/export-manifest.json; fi; \
	rm -rf "$$tmp"; \
	echo "imported exported MSF web assets from $(WEB_EXPORT)"

build: package

package: frontend
	mkdir -p $(DIST)
	CGO_ENABLED=0 GOOS=$(GOOS) GOARCH=$(GOARCH) go build -buildvcs=true -trimpath -ldflags '$(LDFLAGS)' -o $(BIN) ./cmd/msf
	rm -rf $(PACKAGE_DIR)
	mkdir -p $(PACKAGE_DIR)/systemd
	cp $(BIN) $(PACKAGE_DIR)/$(APP_NAME)
	cp packaging/install.sh packaging/uninstall.sh $(PACKAGE_DIR)/
	cp packaging/systemd/$(APP_NAME).service $(PACKAGE_DIR)/systemd/
	cp packaging/README-linux-amd64.md $(PACKAGE_DIR)/README.md
	cp LICENSE THIRD_PARTY_NOTICES.md $(PACKAGE_DIR)/
	chmod 0755 $(PACKAGE_DIR)/$(APP_NAME) $(PACKAGE_DIR)/install.sh $(PACKAGE_DIR)/uninstall.sh
	cd $(PACKAGE_DIR) && if command -v sha256sum >/dev/null 2>&1; then find . -type f ! -name SHA256SUMS -print | LC_ALL=C sort | xargs sha256sum > SHA256SUMS; else find . -type f ! -name SHA256SUMS -print | LC_ALL=C sort | xargs shasum -a 256 > SHA256SUMS; fi
	cd $(DIST) && tar -czf $(APP_NAME)-$(GOOS)-$(GOARCH).tar.gz $(notdir $(PACKAGE_DIR))

verify-release-source:
	@test "$(VERSION)" != "0.1.0-dev" || { echo "VERSION must be set for a release build" >&2; exit 1; }
	@test "$(RELEASE_TAG)" = "v$(VERSION)" || { echo "RELEASE_TAG $(RELEASE_TAG) does not match VERSION $(VERSION)" >&2; exit 1; }
	@test "$(BUILD_DIRTY)" = "false" || { echo "release builds require a clean worktree" >&2; git status --short >&2; exit 1; }
	@test "$$(git rev-parse --verify '$(RELEASE_TAG)^{commit}' 2>/dev/null)" = "$(GIT_COMMIT)" || { echo "$(RELEASE_TAG) must exist and point at HEAD $(GIT_COMMIT)" >&2; exit 1; }

release-package: verify-release-source package
	@go version -m $(BIN) | grep -q 'vcs.modified=false' || { echo "$(BIN) was built with vcs.modified=true" >&2; exit 1; }

release-assets: verify-release-source
	$(MAKE) release-package VERSION=$(VERSION) RELEASE_TAG=$(RELEASE_TAG) GOOS=linux GOARCH=amd64 BUILD_TIME=$(BUILD_TIME)
	$(MAKE) release-package VERSION=$(VERSION) RELEASE_TAG=$(RELEASE_TAG) GOOS=linux GOARCH=arm64 BUILD_TIME=$(BUILD_TIME)
	$(MAKE) unraid VERSION=$(VERSION) UNRAID_VERSION=$(VERSION) RELEASE_TAG=$(RELEASE_TAG) BUILD_TIME=$(BUILD_TIME)
	$(MAKE) fnos VERSION=$(VERSION) GOARCH=amd64 RELEASE_TAG=$(RELEASE_TAG) BUILD_TIME=$(BUILD_TIME)
	$(MAKE) fnos VERSION=$(VERSION) GOARCH=arm64 RELEASE_TAG=$(RELEASE_TAG) BUILD_TIME=$(BUILD_TIME)
	$(MAKE) checksums VERSION=$(VERSION)
	$(MAKE) verify-release-assets VERSION=$(VERSION) RELEASE_TAG=$(RELEASE_TAG)

unraid: package
	APP_NAME=$(APP_NAME) VERSION=$(VERSION) UNRAID_VERSION=$(UNRAID_VERSION) GITHUB_REPO=$(GITHUB_REPO) RELEASE_TAG=$(RELEASE_TAG) DIST=$(DIST) packaging/unraid/build-unraid.sh

fnos: package
	APP_NAME=$(APP_NAME) VERSION=$(VERSION) DIST=$(DIST) ARCH=$(GOARCH) packaging/fnos/build-fpk.sh

checksums:
	@if command -v sha256sum >/dev/null 2>&1; then \
		for file in \
			$(DIST)/msf-linux-amd64.tar.gz \
			$(DIST)/msf-linux-arm64.tar.gz \
			$(DIST)/unraid/msf-$(VERSION)-x86_64-1.txz $(DIST)/unraid/msf.plg \
			$(DIST)/msf_$(VERSION)_x86.fpk $(DIST)/msf_$(VERSION)_arm.fpk; do \
			sha256sum "$$file" > "$$file.sha256"; \
		done; \
	else \
		for file in \
			$(DIST)/msf-linux-amd64.tar.gz \
			$(DIST)/msf-linux-arm64.tar.gz \
			$(DIST)/unraid/msf-$(VERSION)-x86_64-1.txz $(DIST)/unraid/msf.plg \
			$(DIST)/msf_$(VERSION)_x86.fpk $(DIST)/msf_$(VERSION)_arm.fpk; do \
			shasum -a 256 "$$file" > "$$file.sha256"; \
		done; \
	fi

verify-release-assets:
	scripts/release/verify-release-assets.sh "$(VERSION)" "$(GIT_COMMIT)" "$(RELEASE_TAG)" "$(DIST)"

dev:
	go run ./cmd/msf serve -c ./data -p 7777

test:
	go test ./...

test-dns-fixture:
	npm run test:dns-fixture

test-e2e-ipv6:
	npm run test:e2e:ipv6

audit-compliance:
	scripts/compliance/audit-compliance.sh

macos-app-project:
	cd $(MACOS_APP_DIR) && xcodegen generate

macos-app-test:
	cd $(MACOS_APP_DIR) && DEVELOPER_DIR=$(XCODE_DEVELOPER_DIR) xcrun swift test

macos-app-build: macos-app-build-debug

macos-app-build-debug: frontend macos-app-project
	cd $(MACOS_APP_DIR) && DEVELOPER_DIR=$(XCODE_DEVELOPER_DIR) xcodebuild \
		-project MSFMenuBar.xcodeproj \
		-scheme MSFMenuBar \
		-configuration Debug \
		-derivedDataPath DerivedData \
		ONLY_ACTIVE_ARCH=NO \
		CODE_SIGNING_ALLOWED=NO \
		build

macos-app-build-release: frontend macos-app-project
	cd $(MACOS_APP_DIR) && DEVELOPER_DIR=$(XCODE_DEVELOPER_DIR) xcodebuild \
		-project MSFMenuBar.xcodeproj \
		-scheme MSFMenuBar \
		-configuration Release \
		-derivedDataPath DerivedData \
		ONLY_ACTIVE_ARCH=NO \
		CODE_SIGNING_ALLOWED=NO \
		build

macos-app-build-release-assets: frontend macos-app-project
	@test "$(VERSION)" != "0.1.0-dev" || { echo "VERSION must be set for a macOS release build" >&2; exit 1; }
	cd $(MACOS_APP_DIR) && DEVELOPER_DIR=$(XCODE_DEVELOPER_DIR) xcodebuild \
		-project MSFMenuBar.xcodeproj \
		-scheme MSFMenuBar \
		-configuration Release \
		-derivedDataPath DerivedData \
		ONLY_ACTIVE_ARCH=NO \
		ARCHS="arm64 x86_64" \
		MARKETING_VERSION="$(VERSION)" \
		CURRENT_PROJECT_VERSION="$(MACOS_BUILD_NUMBER)" \
		MSF_VERSION="$(VERSION)" \
		MSF_BUILD_COMMIT="$(GIT_COMMIT)" \
		MSF_BUILD_TAG="$(BUILD_TAG)" \
		MSF_BUILD_TAG_COMMIT="$(TAG_COMMIT)" \
		MSF_BUILD_SOURCE_COMMIT="$(SOURCE_COMMIT)" \
		MSF_BUILD_DIRTY="$(BUILD_DIRTY)" \
		MSF_BUILD_TIME="$(BUILD_TIME)" \
		ENABLE_HARDENED_RUNTIME=NO \
		CODE_SIGNING_ALLOWED=NO \
		CODE_SIGNING_REQUIRED=NO \
		build

macos-app-build-signed: frontend macos-app-project
	@test "$(VERSION)" != "0.1.0-dev" || { echo "VERSION must be set for a signed macOS build" >&2; exit 1; }
	@test -n "$(MACOS_DEVELOPMENT_TEAM)" || { echo "MACOS_DEVELOPMENT_TEAM is required" >&2; exit 1; }
	@test -n "$(MACOS_SIGNING_IDENTITY)" || { echo "MACOS_SIGNING_IDENTITY is required" >&2; exit 1; }
	cd $(MACOS_APP_DIR) && DEVELOPER_DIR=$(XCODE_DEVELOPER_DIR) xcodebuild \
		-project MSFMenuBar.xcodeproj \
		-scheme MSFMenuBar \
		-configuration Release \
		-derivedDataPath DerivedData \
		ONLY_ACTIVE_ARCH=NO \
		ARCHS="arm64 x86_64" \
		MARKETING_VERSION="$(VERSION)" \
		CURRENT_PROJECT_VERSION="$(MACOS_BUILD_NUMBER)" \
		MSF_VERSION="$(VERSION)" \
		MSF_BUILD_COMMIT="$(GIT_COMMIT)" \
		MSF_BUILD_TAG="$(BUILD_TAG)" \
		MSF_BUILD_TAG_COMMIT="$(TAG_COMMIT)" \
		MSF_BUILD_SOURCE_COMMIT="$(SOURCE_COMMIT)" \
		MSF_BUILD_DIRTY="$(BUILD_DIRTY)" \
		MSF_BUILD_TIME="$(BUILD_TIME)" \
		SWIFT_ACTIVE_COMPILATION_CONDITIONS='$$(inherited) MSF_SIGNED_RELEASE' \
		CODE_SIGNING_ALLOWED=YES \
		CODE_SIGNING_REQUIRED=YES \
		CODE_SIGN_STYLE=Manual \
		CODE_SIGN_IDENTITY="$(MACOS_SIGNING_IDENTITY)" \
		DEVELOPMENT_TEAM="$(MACOS_DEVELOPMENT_TEAM)" \
		CODE_SIGN_INJECT_BASE_ENTITLEMENTS=NO \
		OTHER_CODE_SIGN_FLAGS="--timestamp" \
		build

macos-app-verify:
	cd $(MACOS_APP_DIR) && DEVELOPER_DIR=$(XCODE_DEVELOPER_DIR) Scripts/verify-app.sh $(MACOS_CONFIGURATION)

macos-release-assets: verify-release-source macos-app-build-release-assets
	cd $(MACOS_APP_DIR) && \
		Scripts/package-release.sh "$(VERSION)" "$(RELEASE_TAG)" "$(GIT_COMMIT)" "$(abspath $(MACOS_RELEASE_DIR))"

macos-release-assets-signed: verify-release-source macos-app-build-signed
	@test -n "$(MACOS_NOTARY_PROFILE)" || { echo "MACOS_NOTARY_PROFILE is required" >&2; exit 1; }
	cd $(MACOS_APP_DIR) && \
		MACOS_SIGNING_IDENTITY="$(MACOS_SIGNING_IDENTITY)" \
		MACOS_NOTARY_PROFILE="$(MACOS_NOTARY_PROFILE)" \
		Scripts/package-release-signed.sh "$(VERSION)" "$(RELEASE_TAG)" "$(GIT_COMMIT)" "$(abspath $(MACOS_RELEASE_DIR))"

macos-app-open: macos-app-build-debug
	open $(MACOS_APP_DIR)/DerivedData/Build/Products/Debug/MSF.app

clean:
	rm -rf $(DIST)
