# 定義預設版本，讓 CI 可以透過 --build-arg 覆蓋
ARG PYTHON_VERSION=3.13


# ----- 🧱 Base -----
FROM ghcr.io/astral-sh/uv:python${PYTHON_VERSION}-trixie-slim AS base

WORKDIR /app

# 從靜態映像檔拷貝 ffmpeg (最快且最輕量)
COPY --from=mwader/static-ffmpeg:7.1 /ffmpeg /usr/local/bin/
COPY --from=mwader/static-ffmpeg:7.1 /ffprobe /usr/local/bin/


# ----- 📦 Build -----
FROM base AS build

COPY .python-version LICENSE pyproject.toml README.md ./
COPY src src/
RUN uv sync && \
    uv build


# ----- 🧪 Test -----
FROM base AS test

COPY . .
RUN uv sync --frozen
# 預設執行 BDD 測試
CMD ["uv", "run", "behave"]


# ----- 🚀 Publish -----
FROM base AS publish

COPY --from=build /app/dist dist/
CMD [ "uv", "publish", "dist/*" ]
