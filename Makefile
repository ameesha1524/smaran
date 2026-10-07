# Smaran — one entry point for the common tasks.
#
#   make baseline       install, typecheck, build the frontend; test the backend
#   make test           fast tests: Vitest and the backend unit tests
#   make verify         everything, including the backend on a real PostgreSQL
#   make db             start PostgreSQL in Docker
#   make dev-backend    API on :8080 against that database (dev profile, auth OFF)
#   make dev-backend-nodocker   the same with no Docker: embedded PostgreSQL
#   make dev-frontend   PWA on :5173
#   make golden         regenerate golden-vectors.json after a scoring change
#
# `demo`, `ds` and `e2e` are declared here so the names are stable, and fail
# loudly until the phase that builds them lands. See docs/PLAN.md.
#
# On Windows without make, run the commands under each target by hand, or
# install make (`winget install GnuWin32.Make`).

MVN ?= mvn
NPM ?= npm

.PHONY: baseline test verify frontend-install frontend-check frontend-test frontend-build
.PHONY: backend-test backend-verify db dev-backend dev-backend-nodocker dev-frontend golden
.PHONY: demo ds e2e

baseline: frontend-install frontend-check frontend-build backend-test

test: frontend-check frontend-test backend-test

verify: frontend-check frontend-test frontend-build backend-verify

frontend-install:
	cd frontend && $(NPM) ci

frontend-check:
	cd frontend && npx tsc -b && npx tsc -p tsconfig.test.json

frontend-test:
	cd frontend && $(NPM) test

frontend-build:
	cd frontend && $(NPM) run build

golden:
	cd frontend && $(NPM) run golden

backend-test:
	cd backend && $(MVN) -B test

# Unit tests plus the *IT classes. Uses Docker (Testcontainers) when it is
# there and an embedded PostgreSQL when it is not.
backend-verify:
	cd backend && $(MVN) -B verify

db:
	docker compose up -d db

dev-backend:
	cd backend && $(MVN) -Dspring-boot.run.profiles=dev spring-boot:run

dev-backend-nodocker:
	cd backend && $(MVN) spring-boot:test-run -Dspring-boot.run.main-class=org.smaran.LocalDevApplication

dev-frontend:
	cd frontend && $(NPM) run dev

demo:
	@echo "make demo is not built yet: it needs the synthetic cohort and the full stack (Phases 5, 6)." && exit 1

ds:
	@echo "make ds is not built yet: data-science/ arrives in Phase 5." && exit 1

e2e:
	@echo "make e2e is not built yet: the Playwright suite arrives in Phase 7." && exit 1
