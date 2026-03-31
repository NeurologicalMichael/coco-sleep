import Foundation
import WidgetKit

/// Exposed to ObjC so WidgetKitModule.m can call it.
@objc class WidgetKitHelper: NSObject {
  @objc static func reloadAll() {
    if #available(iOS 14.0, *) {
      WidgetCenter.shared.reloadAllTimelines()
    }
  }
}
