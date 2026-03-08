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


# ----- 🧪 Test -----
FROM base AS test

# 安裝測試所需的 ffmpeg
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

COPY . .
RUN uv sync --frozen

# 預設執行測試
CMD ["uv", "run", "behave"]


# ----- 🚀 Publish -----
FROM base AS publish

COPY --from=build /app/dist dist/
CMD [ "uv", "publish", "dist/*" ]
