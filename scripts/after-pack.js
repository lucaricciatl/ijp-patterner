/**
 * electron-builder afterPack hook.
 *
 * Without a Developer ID electron-builder silently skips signing ("0 identities
 * found") and still produces a DMG — which then dies on first launch with
 * "app is damaged". Ad-hoc signing keeps it openable; it is not notarised.
 * afterPack runs before the DMG target, so the image contains the signed bundle.
 */
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );

  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
  console.log(`  • ad-hoc signed ${path.basename(appPath)}`);
};
