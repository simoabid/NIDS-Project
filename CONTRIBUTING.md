# Contributing to NIDS Project

Thank you for your interest in contributing! This is a final-year project (PFE) for a Network Intrusion Detection System built with Python, Node.js, and React. Contributions of all kinds are welcome.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [How to Contribute](#how-to-contribute)
- [Development Setup](#development-setup)
- [Branch Strategy](#branch-strategy)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Reporting Issues](#reporting-issues)
- [License](#license)

## Code of Conduct

- Be respectful and constructive in all interactions.
- Do not commit secrets, credentials, or `.env` files.
- Do not commit binary model artifacts (`.pkl` files) — they are gitignored.
- Network captures and datasets must stay local; never push PCAPs or CSVs to the repository.

## Getting Started

1. **Fork** this repository and clone your fork locally.
2. Read [DEVELOPMENT.md](DEVELOPMENT.md) for the full project structure and setup guide.
3. Read [CHANGELOG.md](CHANGELOG.md) for recent changes and context.
4. Copy `.env.example` to `.env` and fill in your values before running anything.

## How to Contribute

- **Backend improvements** — API endpoints, Socket.io events, MongoDB models, Redis integration.
- **AI model enhancements** — New datasets (e.g., CICIDS2017), feature engineering, model tuning.
- **Frontend dashboard** — Real-time visualizations, alert management, responsive design.
- **Infrastructure** — Docker configs, Nginx routing, Prometheus/Grafana dashboards.
- **Documentation** — Improving guides, code comments, or developer onboarding.
- **Testing** — Unit tests, integration tests, and end-to-end pipeline verification.

## Development Setup

### Prerequisites

- **Node.js 22+** and npm
- **Python 3.12+** with venv
- **Docker** and Docker Compose
- **MongoDB 7** and **Redis 7** (or use Docker Compose)

### Quick Start (without Docker)

```bash
# Backend
cd backend
npm install
npm run seed       # create admin user
npm run dev        # starts on :5000

# Frontend
cd frontend
npm install
npm run dev        # starts on :3000, proxies API to :5000

# AI Service
cd ai-service
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m src.train                     # train model (required before first run)
uvicorn src.main:app --reload --port 8000
```

### Quick Start (with Docker)

```bash
cp .env.example .env                    # edit values as needed
python -m src.train                     # model artifacts must exist before build
docker compose up --build -d            # starts all 8 services
docker compose logs -f                  # tail logs
docker compose down                     # stop (volumes preserved)
```

### Running Tests

```bash
# Backend
cd backend && npm test

# AI Service
cd ai-service
source .venv/bin/activate
pytest tests/ -v

# Smoke test (requires running AI service)
./ai-service/tests/smoke_test.sh
```

## Branch Strategy

| Branch | Purpose |
|--------|---------|
| `master` | Stable, tested code. All releases are tagged here. |
| `feature/*` | New features or significant changes. |
| `fix/*` | Bug fixes and patch updates. |
| `phase/*` | Phase-specific development branches. |

Always branch off `master` for new work.

## Commit Guidelines

Write clear, descriptive commit messages following [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <short summary>

<optional body explaining why, not just what>
```

**Types:** `feat`, `fix`, `refactor`, `docs`, `chore`, `test`, `perf`, `ci`

Examples:
- `feat: implement Random Forest training pipeline`
- `fix: align one-hot encoded columns between train and test sets`
- `refactor: extract Redis consumer into standalone module`
- `docs: update DEVELOPMENT.md with AI service setup`
- `test: add pytest cases for PortScan classification`

## Pull Request Process

1. **One concern per PR** — don't bundle unrelated changes.
2. **Test locally** — all tests must pass before submitting.
3. **Describe what and why** — explain the problem, how your change fixes it, and any design trade-offs.
4. **Keep diffs minimal** — avoid reformatting unrelated code.
5. **Update CHANGELOG.md** — add your changes under `[Unreleased]`.
6. **Ensure it builds** — `docker compose build` must succeed with no errors.

### PR template

```markdown
## What does this PR do?
<!-- Brief description -->

## Why is this change needed?
<!-- Context: broken test, new feature, performance issue, etc. -->

## Testing
- [ ] Backend tests pass (`npm test`)
- [ ] AI service tests pass (`pytest tests/ -v`)
- [ ] Smoke test passes (`./tests/smoke_test.sh`)
- [ ] Manual verification (describe steps)

## Checklist
- [ ] Builds without errors
- [ ] All tests pass
- [ ] CHANGELOG.md updated
- [ ] No secrets or binary artifacts committed
- [ ] No unrelated formatting changes
```

## Reporting Issues

When opening an issue, include:

- **Service affected** — Backend, Frontend, AI Service, or Infrastructure
- **Steps to reproduce** the problem
- **Expected vs. actual behavior**
- **Logs** — relevant output from `docker compose logs` or terminal
- **Environment** — OS, Docker version, Node/Python version
- **Screenshots** if applicable (especially for frontend issues)

Issues without sufficient detail may be closed.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE), consistent with this project.
