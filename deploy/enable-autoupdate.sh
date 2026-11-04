#!/bin/bash
# 이미 설치된 서버에 "자동 업데이트"만 켜는 스크립트 (한 번만 실행)
#   sudo bash /opt/for10/deploy/enable-autoupdate.sh
# 이후로는 10분마다 GitHub를 확인해서 새 버전이 있으면 받아서 재시작해요.
set -e
cat > /usr/local/bin/for10-autoupdate <<'AUTO'
#!/bin/bash
cd /opt/for10 || exit 0
git fetch -q origin || exit 0
if [ "$(git rev-parse HEAD)" != "$(git rev-parse '@{u}')" ]; then
  git pull -q --ff-only && systemctl restart for10 && echo "$(date) 자동 업데이트 $(git rev-parse --short HEAD)" >> /var/log/for10-update.log
fi
AUTO
chmod +x /usr/local/bin/for10-autoupdate
echo '*/10 * * * * root /usr/local/bin/for10-autoupdate' > /etc/cron.d/for10-autoupdate
/usr/local/bin/for10-autoupdate
echo "자동 업데이트를 켰어요. 현재 버전: $(git -C /opt/for10 rev-parse --short HEAD)"
