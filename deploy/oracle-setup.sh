#!/bin/bash
# =====================================================================
#  포텐체대입시 부산교육원 앱 — 무료 서버 자동 설치 (오라클 클라우드 · 구글 클라우드)
#  오라클: 인스턴스 만들 때 "cloud-init 스크립트" 칸 / 구글: VM 만들 때 "시작 스크립트" 칸에 붙여 넣으면
#  서버가 처음 켜질 때 아래가 모두 자동으로 진행돼요 (약 5~10분):
#   1) Node.js 설치  2) 앱 내려받기  3) 자동 실행 등록
#   4) https 인증서(Caddy)  5) 매일 백업  6) 주소(DuckDNS) 자동 갱신
#  이미 만든 서버에서 직접 실행해도 돼요:  sudo bash oracle-setup.sh
# =====================================================================
# ▼▼▼ 아래 다섯 줄만 바꿔서 쓰세요 ▼▼▼
REPO_URL="https://github.com/for10busan/for10busan.git"   # 앱 코드가 있는 GitHub 주소
DOMAIN="for10busan.duckdns.org"                                # 앱 주소 (DuckDNS에서 만든 이름)
DUCKDNS_TOKEN=""                                               # DuckDNS 토큰 (DuckDNS 주소를 쓸 때)
ADMIN_EMAIL="admin@for10.kr"                                   # 첫 원장 계정 이메일
ADMIN_PASSWORD="ChangeMe1234"                                  # 첫 원장 비밀번호 (로그인 후 바꾸세요)
# ▲▲▲ 여기까지 ▲▲▲
set -euo pipefail
exec > >(tee -a /var/log/for10-setup.log) 2>&1
echo "=== FOR10 설치 시작: $(date) ==="
export DEBIAN_FRONTEND=noninteractive
APP_DIR=/opt/for10
DATA_DIR=/var/lib/for10

# 0) 작은 서버(메모리 1GB)를 위한 스왑 2GB
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# 1) 서버 방화벽에서 80·443 포트 열기 (오라클 우분투 이미지는 기본으로 막혀 있음)
apt-get update -y
apt-get install -y git sqlite3 curl ca-certificates debian-keyring debian-archive-keyring apt-transport-https iptables-persistent
for P in 80 443; do
  iptables -C INPUT -p tcp --dport $P -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -p tcp --dport $P -j ACCEPT
done
netfilter-persistent save || true

# 2) Node.js 22 (서버 종류 ARM/AMD 자동 판별)
ARCH=$(uname -m); case "$ARCH" in aarch64) NA=arm64;; x86_64) NA=x64;; *) echo "지원하지 않는 CPU: $ARCH"; exit 1;; esac
if ! /opt/node/bin/node -v 2>/dev/null | grep -q '^v22'; then
  NODE_FILE=$(curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt | grep -o "node-v22[^ ]*-linux-$NA.tar.xz" | head -1)
  curl -fsSL "https://nodejs.org/dist/latest-v22.x/$NODE_FILE" -o /tmp/node.tar.xz
  rm -rf /opt/node && mkdir -p /opt/node && tar -xJf /tmp/node.tar.xz -C /opt/node --strip-components=1
  ln -sf /opt/node/bin/node /usr/local/bin/node && ln -sf /opt/node/bin/npm /usr/local/bin/npm
fi

# 3) 앱 내려받기
id for10 >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin for10
mkdir -p "$DATA_DIR" && chown -R for10:for10 "$DATA_DIR"
if [ -d "$APP_DIR/.git" ]; then git -C "$APP_DIR" pull --ff-only; else git clone --depth 1 "$REPO_URL" "$APP_DIR"; fi
# 저장소 안에 for10 폴더째 올린 경우도 처리
[ -f "$APP_DIR/server.js" ] || { [ -f "$APP_DIR/for10/server.js" ] && ln -sfn "$APP_DIR/for10" /opt/for10-app; }
RUN_DIR=$([ -f "$APP_DIR/server.js" ] && echo "$APP_DIR" || echo /opt/for10-app)

# 4) 자동 실행 (서버가 재부팅돼도 다시 켜짐)
cat > /etc/for10.env <<EOF
PORT=3000
DATA_DIR=$DATA_DIR
ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_PASSWORD=$ADMIN_PASSWORD
MAX_VIDEO_MB=300
EOF
chmod 600 /etc/for10.env
cat > /etc/systemd/system/for10.service <<EOF
[Unit]
Description=FOR10 Busan app
After=network.target
[Service]
User=for10
WorkingDirectory=$RUN_DIR
EnvironmentFile=/etc/for10.env
ExecStart=/opt/node/bin/node --no-warnings server.js
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload && systemctl enable --now for10

# 5) DuckDNS 주소가 늘 이 서버를 가리키도록 5분마다 갱신
if [ -n "$DUCKDNS_TOKEN" ]; then
  SUB="${DOMAIN%%.duckdns.org}"
  echo "*/5 * * * * root curl -fsS 'https://www.duckdns.org/update?domains=$SUB&token=$DUCKDNS_TOKEN&ip=' >/dev/null 2>&1" > /etc/cron.d/duckdns
  curl -fsS "https://www.duckdns.org/update?domains=$SUB&token=$DUCKDNS_TOKEN&ip=" || true
  sleep 20
fi

# 6) https (Let's Encrypt 인증서 자동 발급·갱신)
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
  encode gzip
  request_body {
    max_size 320MB
  }
  reverse_proxy localhost:3000
}
EOF
systemctl restart caddy

# 7) 매일 새벽 4시 백업 (최근 14일치 보관)
cat > /usr/local/bin/for10-backup <<'EOF'
#!/bin/bash
D=/var/lib/for10/backups; mkdir -p $D
sqlite3 /var/lib/for10/app.db ".backup '$D/app-$(date +%F).db'"
find $D -name 'app-*.db' -mtime +14 -delete
chown -R for10:for10 $D
EOF
chmod +x /usr/local/bin/for10-backup
echo "0 4 * * * root /usr/local/bin/for10-backup" > /etc/cron.d/for10-backup

# 8) 앱 업데이트 명령:  sudo for10-update
cat > /usr/local/bin/for10-update <<EOF
#!/bin/bash
git -C $APP_DIR pull --ff-only && systemctl restart for10 && echo "업데이트 완료"
EOF
chmod +x /usr/local/bin/for10-update

echo "=== 설치 완료: https://$DOMAIN  ($(date)) ==="
