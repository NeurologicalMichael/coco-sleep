#import <React/RCTBridgeModule.h>
#import "CocoSleep-Swift.h"

@interface CocoWidgetKitModule : NSObject <RCTBridgeModule>
@end

@implementation CocoWidgetKitModule

// Exposes as NativeModules.WidgetKit on the JS side
RCT_EXPORT_MODULE(WidgetKit)

RCT_EXPORT_METHOD(reloadAllTimelines) {
  [WidgetKitHelper reloadAll];
}

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

@end
