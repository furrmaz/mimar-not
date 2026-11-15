#!/usr/bin/env bash
# Yönetim paneli (/admin) kullanıcı adı ve parolasını belirler.
# Parola ekranda görünmez, sunucuda yalnız scrypt özeti (ADMIN_PASSWORD_HASH) saklanır.
# Kullanım (sunucuda): sudo bash /opt/mimar-not/deploy/set-admin.sh
set -euo pipefail
DIR=$(cd "$(dirname "$0")" && pwd)
cd "$DIR"
[ -f .env ] || { echo "HATA: $DIR/.env bulunamadı. Önce deploy/install.sh ile kurun."; exit 1; }

APP=$(docker compose ps -q app 2>/dev/null | head -1)
[ -n "$APP" ] || { echo "HATA: Uygulama kapsayıcısı çalışmıyor (cd $DIR && docker compose up -d app)."; exit 1; }
if ! echo -n 'deneme-parola-123' | docker exec -i "$APP" node cloud-dist/server.cjs hash-password >/dev/null 2>&1; then
  echo "HATA: Çalışan sürüm bu özelliği henüz içermiyor. Güncellemenin gelmesini bekleyip (en geç 10 dk) tekrar deneyin."; exit 1
fi

CUR=$(grep '^ADMIN_USER=' .env | cut -d= -f2- || true)
read -r -p "Kullanıcı adı [${CUR:-admin}]: " U; U=${U:-${CUR:-admin}}
[[ "$U" =~ ^[A-Za-z0-9._@-]{3,64}$ ]] || { echo "HATA: Kullanıcı adı 3-64 karakter; harf, rakam, . _ @ - olabilir."; exit 1; }
while true; do
  read -r -s -p "Yeni parola (en az 12 karakter): " P1; echo
  read -r -s -p "Parola tekrar: " P2; echo
  [ "$P1" = "$P2" ] || { echo "Parolalar aynı değil, tekrar deneyin."; continue; }
  [ ${#P1} -ge 12 ] || { echo "En az 12 karakter olmalı."; continue; }
  break
done
HASH=$(printf '%s' "$P1" | docker exec -i "$APP" node cloud-dist/server.cjs hash-password)
unset P1 P2

cp .env ".env.yedek-$(date +%Y%m%d-%H%M%S)"
chmod 600 .env.yedek-*
TMP=$(mktemp)
grep -v -E '^(ADMIN_USER|ADMIN_PASSWORD|ADMIN_PASSWORD_HASH)=' .env > "$TMP" || true
read -r -p "Eski ADMIN_TOKEN parolası kapatılsın mı? (önerilir) [E/h]: " K
if [[ ! "$K" =~ ^[Hh] ]]; then sed -i 's/^ADMIN_TOKEN=.*/ADMIN_TOKEN=/' "$TMP"; fi
{ echo "ADMIN_USER=$U"; echo "ADMIN_PASSWORD_HASH=$HASH"; } >> "$TMP"
cat "$TMP" > .env; rm -f "$TMP"; chmod 600 .env

docker compose up -d app >/dev/null
echo "Tamam. Yönetim paneli: kullanıcı adı \"$U\" ve yeni parolanızla giriş yapın (açık oturumlar kapandı)."
