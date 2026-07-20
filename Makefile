.PHONY: dev build frontend import-web package release-package release-assets checksums verify-release-source verify-release-assets unraid fnos test audit-compliance clean

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
	cp -f $(DIST)/msf-linux-amd64.tar.gz $(DIST)/msm-free-linux-amd64.tar.gz
	cp -f $(DIST)/msf-linux-arm64.tar.gz $(DIST)/msm-free-linux-arm64.tar.gz
	@if command -v sha256sum >/dev/null 2>&1; then \
		for file in \
			$(DIST)/msf-linux-amd64.tar.gz $(DIST)/msm-free-linux-amd64.tar.gz \
			$(DIST)/msf-linux-arm64.tar.gz $(DIST)/msm-free-linux-arm64.tar.gz \
			$(DIST)/unraid/msf-$(VERSION)-x86_64-1.txz $(DIST)/unraid/msf.plg \
			$(DIST)/msf_$(VERSION)_x86.fpk $(DIST)/msf_$(VERSION)_arm.fpk; do \
			sha256sum "$$file" > "$$file.sha256"; \
		done; \
	else \
		for file in \
			$(DIST)/msf-linux-amd64.tar.gz $(DIST)/msm-free-linux-amd64.tar.gz \
			$(DIST)/msf-linux-arm64.tar.gz $(DIST)/msm-free-linux-arm64.tar.gz \
			$(DIST)/unraid/msf-$(VERSION)-x86_64-1.txz $(DIST)/unraid/msf.plg \
			$(DIST)/msf_$(VERSION)_x86.fpk $(DIST)/msf_$(VERSION)_arm.fpk; do \
			shasum -a 256 "$$file" > "$$file.sha256"; \
		done; \
	fi

verify-release-assets:
	scripts/verify-release-assets.sh "$(VERSION)" "$(GIT_COMMIT)" "$(RELEASE_TAG)" "$(DIST)"

dev:
	go run ./cmd/msf serve -c ./data -p 7777

test:
	go test ./...

audit-compliance:
	scripts/audit-compliance.sh

clean:
	rm -rf $(DIST)
