#!/bin/bash
# Rigenera le viste parziali: vista.py sbiadisce ciò che non è nel flusso, render.js (Playwright + viewer di draw.io)
# disegna la v3 a scala 2, ImageMagick ritaglia secondo ritagli.txt (coordinate sul PNG largo 2000 px).
# Uso: RENDER=/percorso/render.js ./rigenera.sh [vista...]
set -e
cd "$(dirname "$0")"
grep -v '^#' ritagli.txt | while read v x0 y0 x1 y1; do
  [ $# -gt 0 ] && [[ ! " $* " =~ " $v " ]] && continue
  python3 vista.py "$v" "$v.drawio" >/dev/null
  node "$RENDER" "$v.drawio" "full-$v.png" 2 >/dev/null
  read X Y W H < <(python3 -c "k=2.116; print(int($x0*k), int($y0*k), min(4232,int($x1*k))-int($x0*k), min(3676,int($y1*k))-int($y0*k))")
  magick "full-$v.png" -crop "${W}x${H}+${X}+${Y}" +repage "$v.png"
  rm "full-$v.png"
  echo "$v ${W}x${H}"
done
