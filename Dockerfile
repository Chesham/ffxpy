ARG IMAGE_BASE=ghcr.io/astral-sh/uv:python3.13-trixie-slim


# ----- 🧱 Base -----
FROM ${IMAGE_BASE} AS base

WORKDIR /app


# ----- 📦 Build -----
FROM base AS build

COPY .python-version LICENSE pyproject.toml README.md ./
COPY src src/
RUN uv sync && \
    uv build


# ----- 🚀 Publish -----
FROM base AS publish

COPY --from=build /app/dist dist/
CMD [ "uv", "publish", "dist/*" ]
