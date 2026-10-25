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
echo "===== CRASH ====="; cat logs/crash.txt | head -80
echo "===== RESUMO ====="; head -60 logs/resumo.txt
echo "===== PID ====="; cat logs/pid.txt logs/top.txt
exit 0
