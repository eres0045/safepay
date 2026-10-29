#!/bin/bash
# Splice the gasless segment into the submitted SafePay demo video.
# Inputs (in the harness dir, NOT committed - video binaries stay out of git):
#   safepay-demo-video.mp4  (original 163.1s cut; back this up first)
#   gasless-segment.mp4     (built from frames-gasless/ by record-gasless-video.js
#                            + narration-gasless.mp3, see docs/relayer.md)
# Layout: original 0..144.55s (intro + problem + base) + gasless segment
# + original closing card, first 10s (includes the full closing narration).
# Result must stay inside the 2-3 min organizer window (target ~178s).
set -e
H="${HARNESS_DIR:-/home/hatch/workspace/harness-safepay}"
FONT=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf
ORIG="$H/safepay-demo-video.mp4"
SEG_LEN="${SEG_LEN:-23.23}"
ffmpeg -y -v error -f concat -safe 0 -i "$H/concat-gasless.txt" -vsync cfr -r 10 \
  -vf "scale=1280:800:force_original_aspect_ratio=decrease,pad=1280:800:(ow-iw)/2:(oh-ih)/2,drawtext=fontfile=$FONT:textfile=$H/cap-gasless.txt:fontsize=26:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=14:x=(w-text_w)/2:y=h-70" \
  -c:v libx264 -pix_fmt yuv420p "$H/gasless-segment-silent.mp4"
ffmpeg -y -v error -i "$H/gasless-segment-silent.mp4" -i "$H/narration-gasless.mp3" \
  -filter_complex "[1:a]adelay=500|500,apad=whole_dur=${SEG_LEN}[aout]" -map 0:v -map "[aout]" \
  -c:v copy -c:a aac -ar 44100 -t "$SEG_LEN" "$H/gasless-segment.mp4"
ffmpeg -y -v error -i "$ORIG" -t 144.55 -r 10 -vf "scale=1280:800:force_original_aspect_ratio=decrease,pad=1280:800:(ow-iw)/2:(oh-ih)/2" \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -ar 44100 "$H/partA.mp4"
ffmpeg -y -v error -ss 144.55 -i "$ORIG" -t 10 -r 10 -vf "scale=1280:800:force_original_aspect_ratio=decrease,pad=1280:800:(ow-iw)/2:(oh-ih)/2" \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -ar 44100 "$H/partC.mp4"
printf "file '%s'\nfile '%s'\nfile '%s'\n" "$H/partA.mp4" "$H/gasless-segment.mp4" "$H/partC.mp4" > "$H/concat-final.txt"
ffmpeg -y -v error -f concat -safe 0 -i "$H/concat-final.txt" -c copy "$H/safepay-demo-video-relayer.mp4"
ffprobe -v error -show_entries format=duration -of csv=p=0 "$H/safepay-demo-video-relayer.mp4"
