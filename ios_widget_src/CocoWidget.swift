import WidgetKit
import SwiftUI

// MARK: - Data model read from App Group UserDefaults
private let appGroup = "group.com.breibart.coco"

struct CocoEntry: TimelineEntry {
    let date: Date
    let recoveryScore: Int
    let streak: Int
    let tierName: String
    let isTracking: Bool
}

// react-native-shared-group-preferences stores values as JSON strings
private func readDefaults() -> CocoEntry {
    let ud = UserDefaults(suiteName: appGroup)

    func intVal(_ key: String) -> Int {
        if let str = ud?.string(forKey: key), let v = Int(str) { return v }
        if let n = ud?.object(forKey: key) as? NSNumber { return n.intValue }
        return 0
    }
    func strVal(_ key: String) -> String {
        ud?.string(forKey: key) ?? ""
    }

    return CocoEntry(
        date: Date(),
        recoveryScore: intVal("recoveryScore"),
        streak: intVal("streak"),
        tierName: strVal("tierName"),
        isTracking: intVal("isTracking") == 1
    )
}

// MARK: - Provider
struct CocoProvider: TimelineProvider {
    func placeholder(in context: Context) -> CocoEntry {
        CocoEntry(date: Date(), recoveryScore: 82, streak: 7, tierName: "Coconut", isTracking: false)
    }

    func getSnapshot(in context: Context, completion: @escaping (CocoEntry) -> Void) {
        completion(context.isPreview ? placeholder(in: context) : readDefaults())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<CocoEntry>) -> Void) {
        let entry = readDefaults()
        // Refresh every 30 min (also reloaded by app via WidgetKit)
        let next = Calendar.current.date(byAdding: .minute, value: 30, to: Date()) ?? Date()
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}

// MARK: - Score color
private func scoreColor(_ score: Int) -> Color {
    if score >= 75 { return Color(red: 0.24, green: 0.86, blue: 0.52) }  // #3DDB85
    if score >= 50 { return Color(red: 0.96, green: 0.78, blue: 0.26) }  // #F5C842
    return Color(red: 1.0, green: 0.18, blue: 0.18)                       // #FF2D2D
}

// MARK: - Small widget (home screen)
struct CocoSmallView: View {
    let entry: CocoEntry

    var body: some View {
        ZStack {
            Color(red: 0.05, green: 0.05, blue: 0.05)

            // Red left accent bar
            HStack(spacing: 0) {
                Rectangle()
                    .fill(Color(red: 1.0, green: 0.18, blue: 0.18))
                    .frame(width: 4)
                Spacer()
            }

            VStack(alignment: .leading, spacing: 4) {
                if entry.isTracking {
                    Text("TRACKING")
                        .font(.system(size: 7, weight: .black))
                        .italic()
                        .foregroundColor(Color(red: 1.0, green: 0.18, blue: 0.18))
                        .tracking(2)

                    Text("ZZZ")
                        .font(.system(size: 28, weight: .black))
                        .italic()
                        .foregroundColor(.white.opacity(0.7))

                    Text("SLEEPING...")
                        .font(.system(size: 9, weight: .black))
                        .italic()
                        .foregroundColor(.white.opacity(0.6))
                        .tracking(1)
                } else {
                    Text("// RECOVERY")
                        .font(.system(size: 7, weight: .black))
                        .italic()
                        .foregroundColor(Color(red: 1.0, green: 0.18, blue: 0.18))
                        .tracking(2)

                    HStack(alignment: .lastTextBaseline, spacing: 2) {
                        Text("\(entry.recoveryScore)")
                            .font(.system(size: 38, weight: .black))
                            .italic()
                            .foregroundColor(scoreColor(entry.recoveryScore))
                        Text("%")
                            .font(.system(size: 14, weight: .black))
                            .italic()
                            .foregroundColor(.white.opacity(0.4))
                    }

                    Text("\(entry.streak)D  \(entry.tierName.uppercased())")
                        .font(.system(size: 8, weight: .black))
                        .italic()
                        .foregroundColor(.white.opacity(0.5))
                        .tracking(1)
                        .lineLimit(1)
                }
            }
            .padding(.leading, 12)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Medium widget (home screen)
struct CocoMediumView: View {
    let entry: CocoEntry

    var body: some View {
        ZStack {
            Color(red: 0.05, green: 0.05, blue: 0.05)

            HStack(spacing: 0) {
                Rectangle()
                    .fill(Color(red: 1.0, green: 0.18, blue: 0.18))
                    .frame(width: 4)

                VStack(alignment: .leading, spacing: 6) {
                    Text("// COCO RECOVERY")
                        .font(.system(size: 8, weight: .black))
                        .italic()
                        .foregroundColor(Color(red: 1.0, green: 0.18, blue: 0.18))
                        .tracking(2)

                    if entry.isTracking {
                        HStack(spacing: 12) {
                            Text("ZZZ")
                                .font(.system(size: 28, weight: .black))
                                .italic()
                                .foregroundColor(.white.opacity(0.7))
                            VStack(alignment: .leading, spacing: 2) {
                                Text("TRACKING SLEEP")
                                    .font(.system(size: 13, weight: .black))
                                    .italic()
                                    .foregroundColor(.white)
                                Text("Keep phone on mattress")
                                    .font(.system(size: 10))
                                    .foregroundColor(.white.opacity(0.5))
                            }
                        }
                    } else {
                        HStack(spacing: 20) {
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(alignment: .lastTextBaseline, spacing: 2) {
                                    Text("\(entry.recoveryScore)")
                                        .font(.system(size: 44, weight: .black))
                                        .italic()
                                        .foregroundColor(scoreColor(entry.recoveryScore))
                                    Text("%")
                                        .font(.system(size: 16, weight: .black))
                                        .italic()
                                        .foregroundColor(.white.opacity(0.4))
                                }
                                Text("RECOVERY")
                                    .font(.system(size: 8, weight: .black))
                                    .italic()
                                    .foregroundColor(.white.opacity(0.4))
                                    .tracking(2)
                            }

                            Divider()
                                .background(Color.white.opacity(0.15))

                            VStack(alignment: .leading, spacing: 8) {
                                StatPill(label: "STREAK", value: "\(entry.streak)D")
                                StatPill(label: "TIER", value: entry.tierName.uppercased())
                            }
                        }
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
            }
        }
    }
}

private struct StatPill: View {
    let label: String
    let value: String
    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label)
                .font(.system(size: 7, weight: .black))
                .italic()
                .foregroundColor(.white.opacity(0.35))
                .tracking(2)
            Text(value)
                .font(.system(size: 13, weight: .black))
                .italic()
                .foregroundColor(.white)
                .lineLimit(1)
        }
    }
}

// MARK: - Lock screen (accessory) widgets
struct CocoAccessoryCircularView: View {
    let entry: CocoEntry
    var body: some View {
        ZStack {
            if entry.isTracking {
                Text("ZZ")
                    .font(.system(size: 14, weight: .black))
                    .italic()
                    .foregroundColor(.white.opacity(0.7))
            } else {
                Gauge(value: Double(entry.recoveryScore), in: 0...100) {
                    Text("REC")
                } currentValueLabel: {
                    Text("\(entry.recoveryScore)")
                        .font(.system(size: 14, weight: .black))
                        .italic()
                }
                .gaugeStyle(.accessoryCircular)
                .tint(scoreColor(entry.recoveryScore))
            }
        }
    }
}

struct CocoAccessoryRectangularView: View {
    let entry: CocoEntry
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            if entry.isTracking {
                Text("// TRACKING")
                    .font(.system(size: 11, weight: .black))
                    .italic()
                Text("Sleep in progress")
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
            } else {
                Text("// COCO RECOVERY")
                    .font(.system(size: 11, weight: .black))
                    .italic()
                Text("\(entry.recoveryScore)% · \(entry.streak)d · \(entry.tierName)")
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct CocoAccessoryInlineView: View {
    let entry: CocoEntry
    var body: some View {
        if entry.isTracking {
            Label("Coco tracking", systemImage: "moon.zzz.fill")
        } else {
            Label("\(entry.recoveryScore)% recovery · \(entry.streak)d streak", systemImage: "heart.fill")
        }
    }
}

// MARK: - Widget configuration
struct CocoWidget: Widget {
    let kind: String = "CocoWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: CocoProvider()) { entry in
            CocoWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Coco Recovery")
        .description("Track your sleep recovery and streak.")
        .supportedFamilies([
            .systemSmall,
            .systemMedium,
            .accessoryCircular,
            .accessoryRectangular,
            .accessoryInline,
        ])
    }
}

struct CocoWidgetEntryView: View {
    @Environment(\.widgetFamily) var family
    let entry: CocoEntry

    var body: some View {
        switch family {
        case .systemSmall:
            CocoSmallView(entry: entry)
        case .systemMedium:
            CocoMediumView(entry: entry)
        case .accessoryCircular:
            CocoAccessoryCircularView(entry: entry)
        case .accessoryRectangular:
            CocoAccessoryRectangularView(entry: entry)
        case .accessoryInline:
            CocoAccessoryInlineView(entry: entry)
        default:
            CocoSmallView(entry: entry)
        }
    }
}
