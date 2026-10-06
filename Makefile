# Smaran — one entry point for the common tasks.
#
#   make baseline     install, typecheck, build the frontend; test the backend
#   make test         all tests that exist today
#   make dev-backend  API on :8080 (dev profile: H2, demo data, auth OFF)
#   make dev-frontend PWA on :5173
#
# `demo`, `ds` and `e2e` are declared here so the names are stable, and fail
# loudly until the phase that builds them lands. See docs/PLAN.md.
#
# On Windows without make, run the commands under each target by hand, or
# install make (`winget install GnuWin32.Make`).

MVN ?= mvn
NPM ?= npm

.PHONY: baseline test frontend-install frontend-check frontend-build backend-test \
        dev-backend dev-frontend demo ds e2e

baseline: frontend-install frontend-check frontend-build backend-test

test: frontend-check backend-test

frontend-install:
	cd frontend && $(NPM) ci

frontend-check:
	cd frontend && npx tsc -b

frontend-build:
	cd frontend && $(NPM) run build

backend-test:
	cd backend && $(MVN) -B test

dev-backend:
	cd backend && $(MVN) -Dspring-boot.run.profiles=dev spring-boot:run

dev-frontend:
	cd frontend && $(NPM) run dev

demo:
	@echo "make demo is not built yet: it needs the Postgres stack and the synthetic cohort (Phases 1, 5, 6)." && exit 1

ds:
	@echo "make ds is not built yet: data-science/ arrives in Phase 5." && exit 1

e2e:
	@echo "make e2e is not built yet: the Playwright suite arrives in Phase 7." && exit 1
