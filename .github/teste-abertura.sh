#!/bin/bash
mkdir -p logs
adb install -r GastoAuto.apk > logs/install.txt 2>&1
adb logcat -c
adb shell am start -W -n com.tadeu.gastoauto/.MainActivity > logs/start.txt 2>&1
sleep 25
adb shell pidof com.tadeu.gastoauto > logs/pid.txt 2>&1 || echo "APP NAO ESTA RODANDO" >> logs/pid.txt
adb shell dumpsys activity activities | grep -E "topResumedActivity|mResumedActivity" > logs/top.txt 2>&1
adb exec-out screencap -p > logs/tela.png
adb logcat -d -b crash > logs/crash.txt 2>&1
adb logcat -d > logs/logcat.txt 2>&1
grep -E "AndroidRuntime|FATAL|ReactNativeJS|Hermes|Exception|libc  " logs/logcat.txt | head -200 > logs/resumo.txt
# testa o backend (connect token)
curl -s -o logs/connect.json -w "%{http_code}" -X POST "$EXPO_PUBLIC_API_URL/api/connect-token" \
  -H "x-app-token: $EXPO_PUBLIC_APP_TOKEN" -H "content-type: application/json" -d '{}' > logs/connect_status.txt
sed -i 's/"accessToken":"\(.\{12\}\)[^"]*"/"accessToken":"\1..."/' logs/connect.json

tap() {  # toca no elemento com o texto $1
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb pull /sdcard/ui.xml /tmp/ui.xml >/dev/null 2>&1
  xy=$(python3 - "$1" <<'PY'
import re,sys
t=open('/tmp/ui.xml',encoding='utf-8').read()
for m in re.finditer(r'text="([^"]*)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"',t):
    if sys.argv[1] in m.group(1):
        a,b,c,d=map(int,m.groups()[1:]); print((a+c)//2,(b+d)//2); break
PY
)
  echo "tap '$1' -> $xy" >> logs/taps.txt
  [ -n "$xy" ] && adb shell input tap $xy
}
tap "Ajustes"; sleep 3
adb exec-out screencap -p > logs/tela_ajustes.png
tap "Conectar conta"; sleep 15
adb exec-out screencap -p > logs/tela_conectar.png
adb logcat -d -b crash > logs/crash2.txt 2>&1

echo "===== CRASH ====="; cat logs/crash.txt | head -80
echo "===== RESUMO ====="; head -60 logs/resumo.txt
echo "===== PID ====="; cat logs/pid.txt logs/top.txt logs/taps.txt logs/connect_status.txt
exit 0
