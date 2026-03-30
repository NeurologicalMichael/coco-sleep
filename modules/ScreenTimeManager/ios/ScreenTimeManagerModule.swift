import ExpoModulesCore
import Foundation

// FamilyControls requires iOS 16+ for .individual authorization
// and is available from iOS 15+ for the frameworks themselves.
// We guard at runtime to keep deployment target at 15.1.

public class ScreenTimeManagerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ScreenTimeManager")

    AsyncFunction("requestAuthorization") { () -> Bool in
      if #available(iOS 16.0, *) {
        try await FamilyControlsBridge.requestAuth()
        return true
      }
      return false
    }

    Function("getAuthorizationStatus") { () -> String in
      if #available(iOS 16.0, *) {
        return FamilyControlsBridge.authStatus()
      }
      return "notDetermined"
    }

    AsyncFunction("presentAppPicker") { () -> Int in
      if #available(iOS 16.0, *) {
        return await FamilyControlsBridge.presentAppPicker()
      }
      return 0
    }

    Function("getSelectedAppsCount") { () -> Int in
      if #available(iOS 16.0, *) {
        return FamilyControlsBridge.getSelectedAppsCount()
      }
      return 0
    }

    AsyncFunction("startSleepBlock") { (_: [String], _: Double) -> Bool in
      if #available(iOS 16.0, *) {
        FamilyControlsBridge.startBlock()
        return true
      }
      return false
    }

    Function("stopSleepBlock") { () -> Bool in
      if #available(iOS 16.0, *) {
        FamilyControlsBridge.stopBlock()
        return true
      }
      return false
    }

    AsyncFunction("scheduleNightlyBlock") { (startHour: Int, startMinute: Int, endHour: Int, endMinute: Int) -> Bool in
      if #available(iOS 16.0, *) {
        try FamilyControlsBridge.scheduleBlock(startHour: startHour, startMinute: startMinute, endHour: endHour, endMinute: endMinute)
        return true
      }
      return false
    }

    Function("cancelNightlyBlock") { () -> Bool in
      if #available(iOS 16.0, *) {
        FamilyControlsBridge.cancelBlock()
        return true
      }
      return false
    }
  }
}
