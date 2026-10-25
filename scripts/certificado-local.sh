#!/bin/bash
# Crea (una sola vez) un certificado de firma de código local en el llavero
# «inicio de sesión» del Mac. Con él la app se firma siempre con la misma
# identidad y el Llavero deja de pedir permiso tras cada actualización.
# No sale del Mac ni sirve para distribuir la app a otras personas.
set -euo pipefail

NAME="Stock Analisis local"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"

if security find-identity -v -p codesigning | grep -q "\"$NAME\""; then
  echo "Ya existe la identidad «$NAME»."
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/cert.cnf" <<CNF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $NAME
[ext]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
CNF

openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -config "$TMP/cert.cnf" \
  -keyout "$TMP/key.pem" -out "$TMP/cert.pem" 2>/dev/null
# Contraseña de un solo uso para el paso de importación (se borra con la carpeta temporal)
PASS="$(openssl rand -hex 16)"
# El Llavero solo acepta PKCS12 con cifrado 3DES y comprobación SHA-1; OpenSSL 3
# (p. ej. el de Homebrew) usa por defecto AES y SHA-256, así que se fijan a mano.
P12_OPTS="-keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1"
openssl version | grep -q "^OpenSSL 3" && P12_OPTS="-legacy $P12_OPTS"
openssl pkcs12 -export $P12_OPTS -inkey "$TMP/key.pem" -in "$TMP/cert.pem" \
  -name "$NAME" -out "$TMP/id.p12" -passout "pass:$PASS"
security import "$TMP/id.p12" -k "$KEYCHAIN" -P "$PASS" -T /usr/bin/codesign >/dev/null
# Confiar en el certificado solo para firmar código (macOS pide la contraseña del Mac una vez)
security add-trusted-cert -r trustRoot -p codeSign -k "$KEYCHAIN" "$TMP/cert.pem"

security find-identity -v -p codesigning | grep "\"$NAME\"" && echo "Identidad «$NAME» creada."
