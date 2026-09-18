#!/usr/bin/env bash
#
# Regenerate static/vendor/opencv/ — this project's custom OpenCV.js build.
#
# The artifact is committed rather than built in CI. Compiling OpenCV takes
# tens of minutes, and more importantly the bytes have to be identical for a
# developer and for CI: the reader ships its digit exemplars as committed
# bitmaps for exactly that reason (docs/reader-assets.md). So this script is run
# by hand when OpenCV is upgraded, and its output is committed.
#
# Usage:  tools/opencv/build.sh [output_dir]
#
# Needs: cmake, python3, a POSIX shell, ~3 GB of disk and roughly half an hour.
# Everything else — the Emscripten toolchain and the OpenCV sources — is
# downloaded here, pinned to the versions below.
set -euo pipefail

# Pinned inputs. Bump these together and re-run; see docs/opencv-js-build.md.
OPENCV_VERSION="4.10.0"
# OpenCV's sources come from the opencv-python sdist rather than from a GitHub
# tarball: the sdist vendors the full upstream tree at a tagged release and is
# available from PyPI, which is reachable from environments that GitHub is not.
OPENCV_SDIST="https://files.pythonhosted.org/packages/4a/e7/b70a2d9ab205110d715906fc8ec83fbb00404aeb3a37a0654fdb68eb0c8c/opencv-python-4.10.0.84.tar.gz"
OPENCV_SDIST_DIR="opencv-python-4.10.0.84"
# Emscripten 3.1.64, by the commit its prebuilt binaries are published under.
# Pinned by hash, not by "latest": the toolchain version is an input to the
# bytes we commit.
EMSCRIPTEN_VERSION="3.1.64"
EMSCRIPTEN_COMMIT="fd61bacaf40131f74987e649a135f1dd559aff60"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
out_dir="${1:-$repo_root/static/vendor/opencv}"
work_dir="${OPENCV_JS_WORK_DIR:-${TMPDIR:-/tmp}/opencv-js-build}"

mkdir -p "$work_dir"
cd "$work_dir"

echo "==> Working in $work_dir"

if [ ! -d install/emscripten ]; then
  echo "==> Fetching Emscripten $EMSCRIPTEN_VERSION ($EMSCRIPTEN_COMMIT)"
  curl -sSL -o wasm-binaries.tar.xz \
    "https://storage.googleapis.com/webassembly/emscripten-releases-builds/linux/$EMSCRIPTEN_COMMIT/wasm-binaries.tar.xz"
  tar xf wasm-binaries.tar.xz
fi

if [ ! -d "$OPENCV_SDIST_DIR" ]; then
  echo "==> Fetching OpenCV $OPENCV_VERSION sources"
  curl -sSL -o opencv-src.tar.gz "$OPENCV_SDIST"
  tar xzf opencv-src.tar.gz
fi

# The published toolchain ships a config pointing at the build bot's own Node.
# Point it at ours instead.
node_bin="$(command -v node)"
cat > em_config <<EOF
import os
ROOT_DIR = '$work_dir/install'
EMSCRIPTEN_ROOT = os.path.join(ROOT_DIR, 'emscripten')
LLVM_ROOT = os.path.join(ROOT_DIR, 'bin')
BINARYEN_ROOT = ROOT_DIR
NODE_JS = '$node_bin'
JS_ENGINES = [NODE_JS]
EOF
export EM_CONFIG="$work_dir/em_config"
export PATH="$work_dir/install/emscripten:$PATH"

# --build_wasm          WebAssembly, not the asm.js fallback.
# --simd                -msimd128. The reader's per-pixel work is the whole
#                       cost of reading a screenshot, and it vectorises.
# --disable_single_file emit opencv_js.wasm beside opencv.js instead of
#                       base64-inlining it into the JavaScript. A separate
#                       file is cached on its own and streaming-compiled,
#                       and it does not grow by a third in base64.
# --config              our whitelist: core and imgproc bindings only.
# BUILD_opencv_dnn/photo/calib3d/features2d/objdetect/video OFF: upstream's
#                       build_js.py turns several of these on by default.
#                       They are most of the default build's size and this
#                       project calls none of them.
echo "==> Configuring and building OpenCV.js (this takes a while)"
python3 "$OPENCV_SDIST_DIR/opencv/platforms/js/build_js.py" build_js \
  --opencv_dir "$work_dir/$OPENCV_SDIST_DIR/opencv" \
  --emscripten_dir "$work_dir/install/emscripten" \
  --build_wasm \
  --simd \
  --disable_single_file \
  --config "$repo_root/tools/opencv/opencv_js.config.py" \
  --cmake_option="-DBUILD_opencv_dnn=OFF" \
  --cmake_option="-DBUILD_opencv_photo=OFF" \
  --cmake_option="-DBUILD_opencv_calib3d=OFF" \
  --cmake_option="-DBUILD_opencv_features2d=OFF" \
  --cmake_option="-DBUILD_opencv_objdetect=OFF" \
  --cmake_option="-DBUILD_opencv_video=OFF"

echo "==> Installing into $out_dir"
mkdir -p "$out_dir"
cp build_js/bin/opencv.js "$out_dir/opencv.js"
cp build_js/bin/opencv_js.wasm "$out_dir/opencv_js.wasm"

# opencv.js is UMD, and the repository's package.json says "type": "module",
# which would make Node parse a .js file here as an ES module and fail on the
# first `require`. This marks the artifact directory — and nothing else — as
# CommonJS. Browsers neither see nor care about it.
cat > "$out_dir/package.json" <<'JSON'
{
  "type": "commonjs",
  "private": true
}
JSON

cat > "$out_dir/BUILD.txt" <<EOF
OpenCV $OPENCV_VERSION, built for the browser and Node by tools/opencv/build.sh.
Emscripten $EMSCRIPTEN_VERSION ($EMSCRIPTEN_COMMIT).
Modules: core and imgproc only. Bindings: tools/opencv/opencv_js.config.py.
WebAssembly in a standalone opencv_js.wasm, SIMD enabled.
Do not edit by hand — re-run the script. See docs/opencv-js-build.md.
EOF

echo "==> Done:"
ls -l "$out_dir"
