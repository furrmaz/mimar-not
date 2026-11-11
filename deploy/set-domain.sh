#!/usr/bin/env bash
# Planhane sitesinin alan adını değiştirir (ör. geçici sslip.io adresinden planhane.com.tr'ye geçiş).
# Önce alan adınızın DNS'inde iki A kaydı açın: "@" ve "www" → sunucu IP'si. Sonra:
#   sudo bash /opt/mimar-not/deploy/set-domain.sh planhane.com.tr
# Eski adres de çalışmaya devam eder (kurulu uygulamalar ona bağlı olabilir); www adresi de eklenir.
set -euo pipefail
NEW=${1:?Kullanım: sudo bash $0 alanadi.com.tr}
NEW=${NEW#https://}; NEW=${NEW#http://}; NEW=${NEW%%/*}; NEW=${NEW#www.}; NEW=${NEW,,}
cd "$(dirname "$0")"
[ -f .env ] || { echo ".env bulunamadı; önce deploy/install.sh ile kurun."; exit 1; }
git -C .. pull -q --ff-only 2>/dev/null || true

OLD=$(grep '^DOMAIN=' .env | cut -d= -f2-)
EXTRA=$(grep '^EXTRA_DOMAINS=' .env | cut -d= -f2- || true)
LIST="www.$NEW $EXTRA"; [ -n "$OLD" ] && [ "$OLD" != "$NEW" ] && LIST="$LIST $OLD"
EXTRA=$(echo "$LIST" | tr ', ' '\n\n' | grep -v '^$' | grep -vxF "$NEW" | awk '!s[$0]++' | paste -sd' ' -)
sed -i '/^DOMAIN=/d;/^EXTRA_DOMAINS=/d' .env
printf 'DOMAIN=%s\nEXTRA_DOMAINS=%s\n' "$NEW" "$EXTRA" >> .env
echo "Alan adı: $NEW  (ayrıca: $EXTRA)"

IP=$(curl -fsS4 --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
for d in $NEW www.$NEW; do
  got=$(getent ahostsv4 "$d" | awk '{print $1; exit}' || true)
  if [ "$got" != "$IP" ]; then
    echo "! $d şu an ${got:-hiçbir adresi} gösteriyor, bu sunucu $IP. DNS A kaydını $IP yapın; HTTPS sertifikası DNS yayıldıktan sonra kendiliğinden alınır."
  fi
done

if docker compose ps --services --status running 2>/dev/null | grep -qx caddy; then
  docker compose --profile caddy up -d
elif docker ps --format '{{.Image}} {{.Ports}}' | grep -Eq '^[^ ]*caddy[^ ]* .*:443->'; then
  bash ./attach-caddy.sh
elif [ -f /etc/nginx/sites-available/mimarnot.conf ] || [ -f /etc/nginx/conf.d/mimarnot.conf ]; then
  for f in /etc/nginx/sites-available/mimarnot.conf /etc/nginx/conf.d/mimarnot.conf; do
    [ -f "$f" ] && sed -i -E "0,/server_name [^;]*;/s//server_name $NEW $EXTRA;/" "$f"
  done
  nginx -t && systemctl reload nginx
  args=(); for d in $NEW $EXTRA; do args+=(-d "$d"); done
  certbot --nginx "${args[@]}" --expand --non-interactive --agree-tos --register-unsafely-without-email --redirect \
    || echo "! HTTPS sertifikası alınamadı; DNS yayılınca betiği yeniden çalıştırın."
else
  echo "Web sunucusu bulunamadı; alan adını kendi web sunucunuzda 127.0.0.1 üzerindeki uygulamaya yönlendirin."
fi

INFO=/root/mimarnot-bilgiler.txt
[ -f "$INFO" ] && sed -i -E "s#https://[^/ ]+#https://$NEW#g" "$INFO"
echo
echo "✓ Site:            https://$NEW"
echo "  Web uygulaması:  https://$NEW/app/"
echo "  Yönetim paneli:  https://$NEW/admin/"
echo "Uygulamaların yeni adrese bağlanması için GitHub'da CLOUD_URL değişkenini https://$NEW yapın (docs/SATIS-KURULUM.md)."
