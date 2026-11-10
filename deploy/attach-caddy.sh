#!/usr/bin/env bash
# Mimar Not'u aynı sunucuda Docker içinde çalışan başka bir projenin Caddy'sinin arkasına bağlar.
# Diğer projenin Caddyfile'ına yalnızca Mimar Not alan adı için bir blok ekler (önce yedek alır).
# Kullanım: sudo bash /opt/mimar-not/deploy/attach-caddy.sh [caddy-kapsayıcı-adı]
set -euo pipefail
cd "$(dirname "$0")"
DOMAIN=$(grep '^DOMAIN=' .env | cut -d= -f2-)
C=${1:-$(docker ps --format '{{.Names}} {{.Image}} {{.Ports}}' | awk '$2 ~ /caddy/ && /:443->/ {print $1; exit}')}
[ -n "$C" ] || { echo "80/443 portlarını kullanan bir Caddy kapsayıcısı bulunamadı."; exit 1; }

NET=$(docker inspect "$C" --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' | grep -v '^$' | head -1 || true)
if [ -z "$NET" ] || [ "$NET" = bridge ] || [ "$NET" = host ]; then
  NET=mimarnot-proxy
  docker network inspect "$NET" >/dev/null 2>&1 || docker network create "$NET" >/dev/null
  docker network connect "$NET" "$C" 2>/dev/null || true
fi

CF=$(docker inspect "$C" --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}')
if [ -z "$CF" ]; then
  D=$(docker inspect "$C" --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy"}}{{.Source}}{{end}}{{end}}')
  [ -n "$D" ] && CF="$D/Caddyfile"
fi
if [ -z "$CF" ] || [ ! -f "$CF" ]; then
  echo "$C kapsayıcısının Caddyfile dosyası bulunamadı. Bağlı klasörler:"
  docker inspect "$C" --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'
  exit 1
fi

cat > docker-compose.override.yml <<YML
# deploy/attach-caddy.sh oluşturdu: uygulamayı $C kapsayıcısının ağına "mimarnot" adıyla bağlar
services:
  app:
    networks:
      default: {}
      dis-proxy:
        aliases: [mimarnot]
networks:
  dis-proxy:
    external: true
    name: $NET
YML
docker compose up -d app

if ! grep -q "reverse_proxy mimarnot:8080" "$CF"; then
  BAK="$CF.yedek-$(date +%Y%m%d%H%M%S)"
  cp "$CF" "$BAK"
  printf '\n# Mimar Not (deploy/attach-caddy.sh)\n%s {\n\tencode gzip\n\treverse_proxy mimarnot:8080\n}\n' "$DOMAIN" >> "$CF"
  if ! docker exec "$C" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
    cat "$BAK" > "$CF"
    echo "Caddy ayarı doğrulanamadı; Caddyfile eski haline döndürüldü ($BAK)."
    docker exec "$C" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile || true
    exit 1
  fi
fi
docker exec "$C" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
echo "✓ $C üzerinden yayında: https://$DOMAIN (HTTPS sertifikası ilk açılışta birkaç saniye sürebilir)"
