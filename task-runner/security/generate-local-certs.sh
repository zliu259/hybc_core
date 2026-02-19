#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT_DIR/security/certs"
mkdir -p "$OUT_DIR"

openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 3650 \
  -keyout "$OUT_DIR/ca.key" \
  -out "$OUT_DIR/ca.crt" \
  -subj "/CN=hybc-local-ca"

for NODE in primary secondary standby; do
  openssl req -newkey rsa:2048 -nodes \
    -keyout "$OUT_DIR/$NODE.key" \
    -out "$OUT_DIR/$NODE.csr" \
    -subj "/CN=hybc-task-runner-$NODE"

  openssl x509 -req -in "$OUT_DIR/$NODE.csr" \
    -CA "$OUT_DIR/ca.crt" -CAkey "$OUT_DIR/ca.key" -CAcreateserial \
    -out "$OUT_DIR/$NODE.crt" -days 825 -sha256
done

echo "Generated local CA and node certs in $OUT_DIR"
