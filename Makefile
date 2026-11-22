.DEFAULT_GOAL := help
.PHONY: help version build build-web build-inference-runtime build-speech-runtime build-service build-macos package-macos dmg test-package-macos test-dmg start-local stop-local check check-go test test-contract test-web test-service test-fuzz test-macos test-lifecycle test-scripts test-web-browser

FUZZ_TIME ?= 10s
FUZZ_WORKERS ?= 2

help:
	@printf '%s\n' 'Cove development tasks:' '  make start-local / stop-local  Build and open / stop the local app' '  make check                     Check source and repository conventions' '  make test                      Run contract, web, Go race, and Swift tests' '  make build                     Build all components' '  make dmg                       Package Cove.app and an ARM64 DMG' '  make test-lifecycle            Test isolated service lifecycle' '  make test-package-macos        Test a disposable macOS package'
	@printf '%s\n' '  make version VERSION=x.y.z     Set release versions and increment the build number (BUILD=n overrides it)'

version:
	node scripts/set-version.mjs "$(VERSION)" "$(BUILD)"

build: build-service build-macos

build-web:
	pnpm run build:web

build-inference-runtime:
	node scripts/prepare-inference-runtime.mjs

build-speech-runtime:
	node scripts/prepare-speech-runtime.mjs

build-service: build-web build-inference-runtime build-speech-runtime
	mkdir -p .artifacts
	cd services/local-service && ../../scripts/go build -o ../../.artifacts/cove-local-service ./cmd/cove-local-service
	scripts/sign-local-service.sh .artifacts/cove-local-service

build-macos:
	cd apps/macos && swift build

package-macos:
	scripts/package-macos.sh

dmg: package-macos

test-package-macos:
	scripts/package-macos.test.sh

start-local:
	scripts/start-local.sh

stop-local:
	scripts/stop-local.sh

test: test-scripts test-contract test-web test-service test-macos

test-scripts:
	node --test scripts/*.test.mjs

test-dmg:
	COVE_TEST_DMG=1 node --test scripts/create-macos-dmg.test.mjs

test-contract:
	pnpm run check:contract
	pnpm run test:contract

test-web: build-web
	pnpm run check:web
	pnpm run test:web

test-service: build-web
	cd services/local-service && ../../scripts/go test -race ./...

test-fuzz:
	cd services/local-service && ../../scripts/go test ./internal/documents -run '^$$' -fuzz '^FuzzParseTextDocument$$' -fuzztime=$(FUZZ_TIME) -parallel=$(FUZZ_WORKERS)
	cd services/local-service && ../../scripts/go test ./internal/provider -run '^$$' -fuzz '^FuzzParseSSEData$$' -fuzztime=$(FUZZ_TIME) -parallel=$(FUZZ_WORKERS)
	cd services/local-service && ../../scripts/go test ./internal/provider -run '^$$' -fuzz '^FuzzSSEContentRoundTrip$$' -fuzztime=$(FUZZ_TIME) -parallel=$(FUZZ_WORKERS)

test-macos:
	cd apps/macos && swift test

test-lifecycle:
	scripts/local-lifecycle.test.sh

check: check-go
	pnpm run check:repo
	pnpm run check:contract
	pnpm run check:web

check-go:
	@test -z "$$(gofmt -l services/local-service)" || { gofmt -l services/local-service; exit 1; }
	cd services/local-service && ../../scripts/go vet ./...

test-web-browser: build-service
	pnpm --filter @cove/web test:browser
