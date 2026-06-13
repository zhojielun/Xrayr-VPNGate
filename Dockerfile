FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl openvpn netcat-openbsd iproute2 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server.py .
COPY public/ ./public/

RUN mkdir -p /app/data /etc/vpngate /var/log

EXPOSE 3001

CMD ["python3", "server.py"]
