.DEFAULT_GOAL := help
.PHONY: help build build-web build-service build-macos package-macos dmg test-package-macos start-local stop-local check check-go test test-contract test-web test-service test-macos test-lifecycle test-scripts test-web-browser

help:
	@printf '%s\n' 'Cove development tasks:' '  make start-local / stop-local  Build and open / stop the local app' '  make check                     Check source and repository conventions' '  make test                      Run contract, web, Go race, and Swift tests' '  make build                     Build all components' '  make dmg                       Package Cove.app and an ARM64 DMG' '  make test-lifecycle            Test isolated service lifecycle' '  make test-package-macos        Test a disposable macOS package'

build: build-service build-macos

build-web:
	pnpm run build:web

build-service: build-web
	mkdir -p .artifacts
	cd services/local-service && ../../scripts/go build -o ../../.artifacts/cove-local-service ./cmd/cove-local-service

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

test-contract:
	pnpm run check:contract
	pnpm run test:contract

test-web: build-web
	pnpm run check:web
	pnpm run test:web

test-service: build-web
	cd services/local-service && ../../scripts/go test -race ./...

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
