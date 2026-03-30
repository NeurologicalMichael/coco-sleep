const { withXcodeProject, withEntitlementsPlist, IOSConfig } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

const WIDGET_TARGET   = 'CocoWidget';
const DA_TARGET       = 'CocoDeviceActivity';
const APP_GROUP       = 'group.com.breibart.coco';
const BUNDLE_ID       = 'com.breibart.coco.widget';
const DA_BUNDLE_ID    = 'com.breibart.coco.deviceactivity';

// ─── 1. Add App Group to main target entitlements ────────────────────────────
const withAppGroup = (config) =>
  withEntitlementsPlist(config, (mod) => {
    const existing = mod.modResults['com.apple.security.application-groups'] ?? [];
    if (!existing.includes(APP_GROUP)) {
      mod.modResults['com.apple.security.application-groups'] = [...existing, APP_GROUP];
    }
    return mod;
  });

// ─── 2. Add Widget Extension target to Xcode project ─────────────────────────
const withWidgetTarget = (config) =>
  withXcodeProject(config, async (mod) => {
    const xcodeProject = mod.modResults;
    const projectRoot = mod.modRequest.projectRoot;
    const iosRoot = path.join(projectRoot, 'ios');
    const widgetDir = path.join(iosRoot, WIDGET_TARGET);
    const srcDir = path.join(projectRoot, 'ios_widget_src', WIDGET_TARGET);

    // Copy Swift source files from our pre-written sources
    const swiftSrc = path.join(projectRoot, 'ios_widget_src');
    if (!fs.existsSync(widgetDir)) {
      fs.mkdirSync(widgetDir, { recursive: true });
    }

    // Copy widget Swift files
    const srcFiles = [
      { src: path.join(swiftSrc, 'CocoWidget.swift'), dst: path.join(widgetDir, 'CocoWidget.swift') },
      { src: path.join(swiftSrc, 'CocoWidgetBundle.swift'), dst: path.join(widgetDir, 'CocoWidgetBundle.swift') },
    ];

    for (const { src, dst } of srcFiles) {
      if (fs.existsSync(src) && !fs.existsSync(dst)) {
        fs.copyFileSync(src, dst);
      }
    }

    // Write widget entitlements
    const entitlementsPath = path.join(widgetDir, `${WIDGET_TARGET}.entitlements`);
    if (!fs.existsSync(entitlementsPath)) {
      fs.writeFileSync(entitlementsPath, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.application-groups</key>
  <array>
    <string>${APP_GROUP}</string>
  </array>
</dict>
</plist>`);
    }

    // Write widget Info.plist
    const infoPlistPath = path.join(widgetDir, 'Info.plist');
    if (!fs.existsSync(infoPlistPath)) {
      fs.writeFileSync(infoPlistPath, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>$(DEVELOPMENT_LANGUAGE)</string>
  <key>CFBundleDisplayName</key>
  <string>CocoWidget</string>
  <key>CFBundleExecutable</key>
  <string>$(EXECUTABLE_NAME)</string>
  <key>CFBundleIdentifier</key>
  <string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>$(PRODUCT_NAME)</string>
  <key>CFBundlePackageType</key>
  <string>XPC!</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>NSExtension</key>
  <dict>
    <key>NSExtensionPointIdentifier</key>
    <string>com.apple.widgetkit-extension</string>
  </dict>
</dict>
</plist>`);
    }

    // Skip if already added
    const targets = xcodeProject.pbxNativeTargetSection();
    const alreadyAdded = Object.values(targets).some(
      (t) => t && t.name === WIDGET_TARGET
    );
    if (alreadyAdded) return mod;

    // Add widget extension target
    const widgetFiles = ['CocoWidget.swift', 'CocoWidgetBundle.swift'];
    const target = xcodeProject.addTarget(
      WIDGET_TARGET,
      'app_extension',
      WIDGET_TARGET,
      BUNDLE_ID
    );

    if (!target) return mod;

    // Add source files
    xcodeProject.addBuildPhase(
      widgetFiles.map((f) => path.join(WIDGET_TARGET, f)),
      'PBXSourcesBuildPhase',
      'Sources',
      target.uuid
    );

    // Add frameworks: WidgetKit and SwiftUI
    xcodeProject.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid);
    xcodeProject.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', target.uuid);

    xcodeProject.addFramework('WidgetKit.framework', { target: target.uuid });
    xcodeProject.addFramework('SwiftUI.framework', { target: target.uuid });

    // Build settings
    const configurations = xcodeProject.pbxXCBuildConfigurationSection();
    Object.keys(configurations).forEach((key) => {
      const config = configurations[key];
      if (config && config.buildSettings && config.buildSettings.PRODUCT_NAME === `"${WIDGET_TARGET}"`) {
        config.buildSettings.SWIFT_VERSION = '5.0';
        config.buildSettings.TARGETED_DEVICE_FAMILY = '"1,2"';
        config.buildSettings.IPHONEOS_DEPLOYMENT_TARGET = '16.0';
        config.buildSettings.CODE_SIGN_ENTITLEMENTS = `"${WIDGET_TARGET}/${WIDGET_TARGET}.entitlements"`;
        config.buildSettings.INFOPLIST_FILE = `"${WIDGET_TARGET}/Info.plist"`;
        config.buildSettings.SWIFT_EMIT_LOC_STRINGS = 'YES';
      }
    });

    return mod;
  });

// ─── 3. Add DeviceActivity Extension target ───────────────────────────────────
const withDeviceActivityTarget = (config) =>
  withXcodeProject(config, async (mod) => {
    const xcodeProject = mod.modResults;
    const projectRoot  = mod.modRequest.projectRoot;
    const iosRoot      = path.join(projectRoot, 'ios');
    const daDir        = path.join(iosRoot, DA_TARGET);
    const swiftSrc     = path.join(projectRoot, 'ios_widget_src', DA_TARGET);

    if (!fs.existsSync(daDir)) fs.mkdirSync(daDir, { recursive: true });

    // Copy Swift source
    const monitorSrc = path.join(swiftSrc, 'CocoDeviceActivityMonitor.swift');
    const monitorDst = path.join(daDir, 'CocoDeviceActivityMonitor.swift');
    if (fs.existsSync(monitorSrc) && !fs.existsSync(monitorDst)) {
      fs.copyFileSync(monitorSrc, monitorDst);
    }

    // Entitlements
    const entitlementsPath = path.join(daDir, `${DA_TARGET}.entitlements`);
    if (!fs.existsSync(entitlementsPath)) {
      fs.writeFileSync(entitlementsPath, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.application-groups</key>
  <array>
    <string>${APP_GROUP}</string>
  </array>
  <key>com.apple.developer.family-controls</key>
  <true/>
</dict>
</plist>`);
    }

    // Info.plist
    const infoPlistPath = path.join(daDir, 'Info.plist');
    if (!fs.existsSync(infoPlistPath)) {
      fs.writeFileSync(infoPlistPath, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>$(DEVELOPMENT_LANGUAGE)</string>
  <key>CFBundleExecutable</key>
  <string>$(EXECUTABLE_NAME)</string>
  <key>CFBundleIdentifier</key>
  <string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>$(PRODUCT_NAME)</string>
  <key>CFBundlePackageType</key>
  <string>XPC!</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>NSExtension</key>
  <dict>
    <key>NSExtensionPointIdentifier</key>
    <string>com.apple.deviceactivity.monitor</string>
    <key>NSExtensionPrincipalClass</key>
    <string>$(PRODUCT_MODULE_NAME).CocoDeviceActivityMonitor</string>
  </dict>
</dict>
</plist>`);
    }

    // Skip if already added
    const targets = xcodeProject.pbxNativeTargetSection();
    if (Object.values(targets).some((t) => t && t.name === DA_TARGET)) return mod;

    const target = xcodeProject.addTarget(DA_TARGET, 'app_extension', DA_TARGET, DA_BUNDLE_ID);
    if (!target) return mod;

    xcodeProject.addBuildPhase(
      [`${DA_TARGET}/CocoDeviceActivityMonitor.swift`],
      'PBXSourcesBuildPhase', 'Sources', target.uuid
    );
    xcodeProject.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid);
    xcodeProject.addBuildPhase([], 'PBXResourcesBuildPhase',  'Resources',  target.uuid);

    xcodeProject.addFramework('DeviceActivity.framework', { target: target.uuid });
    xcodeProject.addFramework('ManagedSettings.framework', { target: target.uuid });
    xcodeProject.addFramework('FamilyControls.framework',  { target: target.uuid });

    const configurations = xcodeProject.pbxXCBuildConfigurationSection();
    Object.keys(configurations).forEach((key) => {
      const cfg = configurations[key];
      if (cfg?.buildSettings?.PRODUCT_NAME === `"${DA_TARGET}"`) {
        cfg.buildSettings.SWIFT_VERSION                = '5.0';
        cfg.buildSettings.TARGETED_DEVICE_FAMILY       = '"1"';
        cfg.buildSettings.IPHONEOS_DEPLOYMENT_TARGET   = '16.0';
        cfg.buildSettings.CODE_SIGN_ENTITLEMENTS       = `"${DA_TARGET}/${DA_TARGET}.entitlements"`;
        cfg.buildSettings.INFOPLIST_FILE               = `"${DA_TARGET}/Info.plist"`;
        cfg.buildSettings.SWIFT_EMIT_LOC_STRINGS       = 'YES';
      }
    });

    return mod;
  });

// ─── Combined plugin ──────────────────────────────────────────────────────────
module.exports = (config) => {
  config = withAppGroup(config);
  config = withWidgetTarget(config);
  config = withDeviceActivityTarget(config);
  return config;
};
