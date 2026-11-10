#!/usr/bin/env bash
# Mimar Not Bulut kurulumu / güncellemesi (Ubuntu 22.04 / 24.04).
# Sunucuda root olarak:
#   curl -fsSL https://raw.githubusercontent.com/furrmaz/mimar-not/main/deploy/install.sh -o mimarnot-kur.sh && sudo bash mimarnot-kur.sh
# Aynı sunucudaki başka projelere dokunmaz: 80/443 boşsa kendi HTTPS'ini (Caddy) kurar; nginx varsa ona
# yeni bir site ekler; uygulama yalnız 127.0.0.1:APP_PORT üzerinde dinler. İkinci çalıştırmada günceller.
set -euo pipefail

DIR=/opt/mimar-not
REPO=https://github.com/furrmaz/mimar-not.git
INFO=/root/mimarnot-bilgiler.txt

say()  { printf '\n\033[1;33m== %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;31m! %s\033[0m\n' "$*"; }
ask()  { local v; read -r -p "$1${2:+ [$2]}: " v </dev/tty; printf '%s' "${v:-${2:-}}"; }
asks() { local v; read -r -s -p "$1: " v </dev/tty; printf '\n' >/dev/tty; printf '%s' "$v"; }
port_busy() { ss -Htln "( sport = :$1 )" | grep -q .; }

[ "$(id -u)" = 0 ] || { echo "Root olarak çalıştırın: sudo bash $0"; exit 1; }
export DEBIAN_FRONTEND=noninteractive

say "1/5 Gerekli programlar"
command -v git >/dev/null || { apt-get update -qq && apt-get install -y -qq git; }
command -v curl >/dev/null || apt-get install -y -qq curl
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || apt-get install -y -qq docker-compose-plugin
ok "Docker $(docker --version | awk '{print $3}' | tr -d ,)"

say "2/5 Kod"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull -q --ff-only && ok "Güncellendi: $(git -C "$DIR" log -1 --format=%s)"
else
  git clone -q "$REPO" "$DIR" && ok "İndirildi: $DIR"
fi
cd "$DIR/deploy"

say "3/5 Ayarlar"
if [ -f .env ]; then
  ok "Mevcut ayarlar kullanılıyor ($DIR/deploy/.env). Değiştirmek için bu dosyayı düzenleyip betiği yeniden çalıştırın."
else
  IP=$(curl -fsS4 --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
  echo "Alan adınız varsa (ör. mimarnot.com.tr) DNS A kaydını $IP adresine yönlendirip buraya yazın."
  echo "Yoksa Enter'a basın; geçici olarak ${IP//./-}.sslip.io adresi kullanılır (HTTPS çalışır, sonra değiştirilebilir)."
  DOMAIN=$(ask "Alan adı" "${IP//./-}.sslip.io")
  KEY=""
  while [[ "$KEY" != sk-ant-* ]]; do KEY=$(asks "Claude API anahtarı (sk-ant-…, yazarken görünmez)"); done
  HFID=$(ask "Higgsfield Key ID (render; yoksa Enter)" "")
  HFSEC=""
  if [[ "$HFID" == *:* ]]; then HFSEC=${HFID#*:}; HFID=${HFID%%:*}   # "KeyID:Secret" tek parça yapıştırıldıysa
  elif [ -n "$HFID" ]; then HFSEC=$(asks "Higgsfield Secret"); fi
  echo "Havale/EFT bilgileri (Abone ol ekranında görünür):"
  BANK=$(ask "  Banka adı" ""); HOLDER=$(ask "  Hesap sahibi" ""); IBAN=$(ask "  IBAN" "")
  MAIL=$(ask "İletişim e-postası" ""); WA=$(ask "WhatsApp numarası (ör. 905321234567)" "")
  WA=${WA//[^0-9]/}; [[ "$WA" == 0* ]] && WA="90${WA#0}"
  COMPANY=$(ask "Satıcı unvanı (kullanım koşullarında görünür)" ""); ADDRESS=$(ask "Satıcı adresi" "")
  APP_PORT=8737; while port_busy "$APP_PORT"; do APP_PORT=$((APP_PORT + 1)); done
  ADMIN=$(openssl rand -hex 16)
  umask 077
  cat > .env <<ENV
DOMAIN=$DOMAIN
APP_PORT=$APP_PORT
ANTHROPIC_API_KEY=$KEY
ADMIN_TOKEN=$ADMIN
HF_API_KEY_ID=$HFID
HF_API_KEY_SECRET=$HFSEC
PAY_BANK=$BANK
PAY_HOLDER=$HOLDER
PAY_IBAN=$IBAN
CONTACT_EMAIL=$MAIL
CONTACT_WHATSAPP=$WA
COMPANY_NAME=$COMPANY
COMPANY_ADDRESS=$ADDRESS
ENV
  umask 022
  ok "Kaydedildi: $DIR/deploy/.env"
fi
DOMAIN=$(grep '^DOMAIN=' .env | cut -d= -f2-)
APP_PORT=$(grep '^APP_PORT=' .env | cut -d= -f2- || true); APP_PORT=${APP_PORT:-8737}
ADMIN=$(grep '^ADMIN_TOKEN=' .env | cut -d= -f2-)

say "4/5 Uygulama derleniyor ve başlatılıyor (ilk seferde 3-5 dakika)"
MODE=""
if docker compose ps --services --status running 2>/dev/null | grep -qx caddy || { ! port_busy 80 && ! port_busy 443; }; then
  docker compose --profile caddy up -d --build
  MODE=caddy
else
  docker compose up -d --build app
  if systemctl is-active --quiet nginx 2>/dev/null; then
    MODE=nginx
    CONF=/etc/nginx/sites-available/mimarnot.conf
    cat > "$CONF" <<NGINX
# Mimar Not (deploy/install.sh tarafından oluşturuldu)
server {
    listen 80;
    server_name $DOMAIN;
    client_max_body_size 50m;
    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
    }
}
NGINX
    if [ -d /etc/nginx/sites-enabled ]; then ln -sf "$CONF" /etc/nginx/sites-enabled/mimarnot.conf; else cp "$CONF" /etc/nginx/conf.d/mimarnot.conf; fi
    nginx -t && systemctl reload nginx
    command -v certbot >/dev/null || apt-get install -y -qq certbot python3-certbot-nginx
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect \
      || warn "HTTPS sertifikası alınamadı. DNS kaydının bu sunucuyu gösterdiğinden emin olup şunu çalıştırın: certbot --nginx -d $DOMAIN"
  elif docker ps --format '{{.Image}} {{.Ports}}' | grep -Eq '^[^ ]*caddy[^ ]* .*:443->'; then
    MODE=caddy-ext
    bash "$DIR/deploy/attach-caddy.sh" || MODE=manual
  else
    MODE=manual
  fi
fi
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; fi

say "5/5 Kontrol"
for _ in $(seq 1 60); do curl -fsS "http://127.0.0.1:$APP_PORT/api/health" >/dev/null 2>&1 && break; sleep 3; done
if curl -fsS "http://127.0.0.1:$APP_PORT/api/health" >/dev/null 2>&1; then ok "Uygulama çalışıyor (127.0.0.1:$APP_PORT)"; else warn "Uygulama yanıt vermiyor. Kayıtlar: cd $DIR/deploy && docker compose logs app"; fi

URL="https://$DOMAIN"
cat > "$INFO" <<TXT
Mimar Not Bulut
Site:            $URL
Web uygulaması:  $URL/app/
Yönetim paneli:  $URL/admin/
Yönetici parolası (ADMIN_TOKEN): $ADMIN
Ayarlar:         $DIR/deploy/.env
Güncelleme:      sudo bash $DIR/deploy/install.sh
Kayıtlar:        cd $DIR/deploy && docker compose logs -f app
TXT
chmod 600 "$INFO"
echo; cat "$INFO"
if [ "$MODE" = manual ]; then
  echo
  warn "80/443 portlarını nginx dışında bir program kullanıyor:"
  ss -Htlnp '( sport = :80 or sport = :443 )' || true
  echo "O programdan $DOMAIN adresini http://127.0.0.1:$APP_PORT adresine yönlendirin (reverse proxy)."
fi
echo
echo "Bu bilgiler $INFO dosyasına kaydedildi. Yönetici parolasını kimseyle paylaşmayın."
echo "Son adım: GitHub → depo → Settings → Secrets and variables → Actions → Variables → CLOUD_URL = $URL"
