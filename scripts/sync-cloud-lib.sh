#!/usr/bin/env bash
# 把共享库平铺拷进各云函数目录。
#
# 两个约束叠加：
#  1. 微信云开发按目录独立部署，共享库必须在每个云函数目录内各存一份
#  2. 开发者工具 CLI 打包不支持云函数内的子目录（会报 EISDIR），所以只能平铺
#
# 主副本在 cloudfunctions/lib/，改那里，然后跑本脚本同步。
set -e
cd "$(dirname "$0")/.."
for fn in daily-sync get-range; do
  [ -d "cloudfunctions/$fn" ] || continue
  # 先清掉上一轮拷进来的（按主副本文件名）
  for f in cloudfunctions/lib/*.js; do
    rm -f "cloudfunctions/$fn/$(basename "$f")"
  done
  rm -rf "cloudfunctions/$fn/lib"
  cp cloudfunctions/lib/*.js "cloudfunctions/$fn/"
  echo "已平铺同步 $(ls cloudfunctions/lib/*.js | wc -l | tr -d ' ') 个文件 → cloudfunctions/$fn/"
done
