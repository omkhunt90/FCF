# FCF Compiler Service Dockerfile
FROM python:3.12-slim

WORKDIR /app

# Install system deps (need docker CLI for sandbox)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Docker CLI (to launch sandbox containers)
RUN curl -fsSL https://get.docker.com | sh

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
