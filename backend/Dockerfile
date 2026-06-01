FROM python:3.11-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends tesseract-ocr poppler-utils && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml uv.lock* ./

RUN pip install uv && uv sync --frozen --no-dev --no-install-project

COPY . .
RUN uv sync --frozen --no-dev

EXPOSE 10000

CMD ["uv", "run", "uvicorn", "paperpilot.api:app", "--host", "0.0.0.0", "--port", "10000"]
