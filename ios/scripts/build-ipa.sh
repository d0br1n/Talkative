#!/usr/bin/env bash
# Builds the unsigned Talkative.ipa (macOS with Xcode and XcodeGen; runs on the CI runner).
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo"

xcodegen generate --spec ios/project.yml

xcodebuild \
  -project ios/Talkative.xcodeproj \
  -scheme Talkative \
  -configuration Release \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -derivedDataPath ios/build \
  -clonedSourcePackagesDirPath ios/build/SourcePackages \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" \
  CURRENT_PROJECT_VERSION="${GITHUB_RUN_NUMBER:-1}" \
  -skipMacroValidation -skipPackagePluginValidation \
  build

rm -rf ios/build/ipa
mkdir -p ios/build/ipa/Payload
cp -R ios/build/Build/Products/Release-iphoneos/Talkative.app ios/build/ipa/Payload/
(cd ios/build/ipa && zip -qr ../Talkative.ipa Payload)
echo "built ios/build/Talkative.ipa"
