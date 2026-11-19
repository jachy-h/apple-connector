import EventKit
import Foundation

let protocolVersion = 2
let maxLineBytes = 1_048_576
let helperVersion = (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "0.17.0"

struct Request: Decodable { let version: Int; let id: String; let action: String; let payload: [String: JSONValue] }
enum JSONValue: Codable {
  case string(String), number(Double), bool(Bool), object([String: JSONValue]), array([JSONValue]), null
  init(from decoder: Decoder) throws { let c = try decoder.singleValueContainer(); if c.decodeNil() { self = .null } else if let x = try? c.decode(Bool.self) { self = .bool(x) } else if let x = try? c.decode(Double.self) { self = .number(x) } else if let x = try? c.decode(String.self) { self = .string(x) } else if let x = try? c.decode([String: JSONValue].self) { self = .object(x) } else { self = .array(try c.decode([JSONValue].self)) } }
  func encode(to encoder: Encoder) throws { var c = encoder.singleValueContainer(); switch self { case .string(let x): try c.encode(x); case .number(let x): try c.encode(x); case .bool(let x): try c.encode(x); case .object(let x): try c.encode(x); case .array(let x): try c.encode(x); case .null: try c.encodeNil() } }
  var string: String? { if case .string(let x) = self { return x }; return nil }
  var int: Int? { if case .number(let x) = self, x.rounded() == x { return Int(x) }; return nil }
}
struct Response: Encodable { let version: Int = protocolVersion; let id: String; let ok: Bool; let result: JSONValue?; let error: HelperError? }
struct HelperError: Encodable { let code: String; let message: String }
enum Failure: Error { case invalid(String), denied(String), unsupported(String), unavailable(String), unknown(String) }
final class AccessResult: @unchecked Sendable {
  private let lock = NSLock(); private var value: Result<Bool, Error> = .failure(Failure.unavailable("Authorization request did not complete."))
  func set(_ next: Result<Bool, Error>) { lock.lock(); value = next; lock.unlock() }
  func get() -> Result<Bool, Error> { lock.lock(); defer { lock.unlock() }; return value }
}

final class Helper {
  private let store = EKEventStore()
  private let isoOutput = ISO8601DateFormatter()
  private let isoWithFractionalSeconds = ISO8601DateFormatter()
  private let isoWithoutFractionalSeconds = ISO8601DateFormatter()
  init() {
    isoOutput.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    isoWithFractionalSeconds.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    isoWithoutFractionalSeconds.formatOptions = [.withInternetDateTime]
  }
  private func instant(_ value: String, field: String) throws -> Date {
    // Do not let Foundation silently interpret a local wall-clock time. The public CLI
    // contract requires an explicit RFC 3339 offset; fractional seconds are optional.
    guard value.range(of: #"(Z|[+-]\d{2}:\d{2})$"#, options: .regularExpression) != nil,
          let date = isoWithFractionalSeconds.date(from: value) ?? isoWithoutFractionalSeconds.date(from: value) else {
      throw Failure.invalid("Invalid argument \"\(field)\": expected an RFC 3339 datetime with an explicit timezone; fractional seconds are optional.")
    }
    return date
  }
  private func defined(_ value: Int?) -> Int? {
    guard let value, value != NSDateComponentUndefined else { return nil }
    return value
  }
  private func gregorian(_ zone: TimeZone? = nil) -> Calendar {
    var calendar = Calendar(identifier: .gregorian)
    if let zone { calendar.timeZone = zone }
    return calendar
  }
  private func validDate(_ year: Int, _ month: Int, _ day: Int) -> Bool {
    var calendar = gregorian()
    calendar.timeZone = TimeZone(identifier: "UTC")!
    var components = DateComponents()
    components.calendar = calendar
    components.year = year
    components.month = month
    components.day = day
    guard let date = calendar.date(from: components) else { return false }
    let back = calendar.dateComponents([.year, .month, .day], from: date)
    return back.year == year && back.month == month && back.day == day
  }
  private func dateParts(_ value: String) -> (Int, Int, Int)? {
    let parts = value.split(separator: "-", omittingEmptySubsequences: false)
    guard parts.count == 3, parts[0].count == 4, parts[1].count == 2, parts[2].count == 2,
          let year = Int(parts[0]), let month = Int(parts[1]), let day = Int(parts[2]),
          validDate(year, month, day) else { return nil }
    return (year, month, day)
  }
  private func timeParts(_ value: String) -> (Int, Int, Int)? {
    let parts = value.split(separator: ":", omittingEmptySubsequences: false)
    guard (parts.count == 2 || parts.count == 3), parts[0].count == 2, parts[1].count == 2,
          parts.count == 2 || parts[2].count == 2,
          let hour = Int(parts[0]), let minute = Int(parts[1]),
          let second = parts.count == 3 ? Int(parts[2]) : 0,
          (0...23).contains(hour), (0...59).contains(minute), (0...59).contains(second) else { return nil }
    return (hour, minute, second)
  }
  // A due kind is derived from EventKit components, never from a formatted Date: missing
  // time components mean date-only, and a nil time zone means floating wall-clock time.
  private func dueObject(_ components: DateComponents?) -> JSONValue {
    guard let components,
          let year = defined(components.year), let month = defined(components.month), let day = defined(components.day) else { return .null }
    let date = String(format: "%04d-%02d-%02d", year, month, day)
    guard let hour = defined(components.hour) else {
      return .object(["kind": .string("date"), "date": .string(date)])
    }
    let minute = defined(components.minute) ?? 0
    let second = defined(components.second) ?? 0
    let time = String(format: "%02d:%02d:%02d", hour, minute, second)
    guard let zone = components.timeZone, TimeZone.knownTimeZoneIdentifiers.contains(zone.identifier) else {
      return .object(["kind": .string("floating"), "date": .string(date), "time": .string(time)])
    }
    let calendar = gregorian(zone)
    guard let moment = calendar.date(from: components) else {
      return .object(["kind": .string("floating"), "date": .string(date), "time": .string(time)])
    }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    formatter.timeZone = zone
    // Foundation reports UTC as "GMT"; keep the public contract stable by normalizing it.
    let zoneId = zone.identifier == "GMT" ? "UTC" : zone.identifier
    return .object([
      "kind": .string("instant"),
      "at": .string(formatter.string(from: moment)),
      "timeZone": .string(zoneId)
    ])
  }
  private func dueComponents(_ value: JSONValue) throws -> DateComponents? {
    if case .null = value { return nil }
    guard case .object(let due) = value, let kind = due["kind"]?.string else { throw Failure.invalid("Invalid due date.") }
    switch kind {
    case "date":
      guard let raw = due["date"]?.string, let (year, month, day) = dateParts(raw) else { throw Failure.invalid("Invalid due date.") }
      let calendar = gregorian()
      return DateComponents(calendar: calendar, year: year, month: month, day: day)
    case "floating":
      guard let rawDate = due["date"]?.string, let rawTime = due["time"]?.string,
            let (year, month, day) = dateParts(rawDate), let (hour, minute, second) = timeParts(rawTime) else { throw Failure.invalid("Invalid due date.") }
      let calendar = gregorian()
      return DateComponents(calendar: calendar, year: year, month: month, day: day, hour: hour, minute: minute, second: second)
    case "instant":
      guard let at = due["at"]?.string, let zoneName = due["timeZone"]?.string, let zone = TimeZone(identifier: zoneName) else { throw Failure.invalid("Invalid due date.") }
      let moment = try instant(at, field: "due.at")
      let calendar = gregorian(zone)
      var components = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: moment)
      components.calendar = calendar
      components.timeZone = zone
      return components
    default: throw Failure.invalid("Invalid due date.")
    }
  }
  private func dueKind(_ components: DateComponents) -> String {
    if defined(components.hour) == nil { return "date" }
    return components.timeZone == nil ? "floating" : "instant"
  }
  private func dueEqual(_ left: DateComponents?, _ right: DateComponents?) -> Bool {
    switch (left, right) {
    case (nil, nil): return true
    case (nil, _), (_, nil): return false
    case (.some(let a), .some(let b)):
      guard dueKind(a) == dueKind(b) else { return false }
      switch dueKind(a) {
      case "date":
        return defined(a.year) == defined(b.year) && defined(a.month) == defined(b.month) && defined(a.day) == defined(b.day)
      case "floating":
        guard b.timeZone == nil else { return false }
        return defined(a.year) == defined(b.year) && defined(a.month) == defined(b.month) && defined(a.day) == defined(b.day)
          && (defined(a.hour) ?? 0) == (defined(b.hour) ?? 0)
          && (defined(a.minute) ?? 0) == (defined(b.minute) ?? 0)
          && (defined(a.second) ?? 0) == (defined(b.second) ?? 0)
      default:
        guard let aZone = a.timeZone, let bZone = b.timeZone, aZone.identifier == bZone.identifier else { return false }
        let calendar = gregorian(aZone)
        guard let aMoment = calendar.date(from: a), let bMoment = calendar.date(from: b) else { return false }
        return abs(aMoment.timeIntervalSince(bMoment)) < 1
      }
    }
  }
  private func require(_ entity: EKEntityType) throws {
    let status = EKEventStore.authorizationStatus(for: entity)
    guard status == .fullAccess else { throw Failure.denied("Full EventKit access has not been granted to the helper.") }
  }
  private func access(_ entity: EKEntityType) -> JSONValue { switch EKEventStore.authorizationStatus(for: entity) { case .fullAccess: return .string("full_access"); case .writeOnly: return .string("write_only"); case .denied: return .string("denied"); case .restricted: return .string("restricted"); case .notDetermined: return .string("not_determined"); @unknown default: return .string("unknown") } }
  private func text(_ p: [String: JSONValue], _ key: String, _ max: Int = 512) throws -> String { guard let value = p[key]?.string, !value.isEmpty, value.utf8.count <= max else { throw Failure.invalid("Invalid \(key).") }; return value }
  private func calendar(_ id: String, entity: EKEntityType) throws -> EKCalendar { guard let c = store.calendar(withIdentifier: id), store.calendars(for: entity).contains(where: { $0.calendarIdentifier == id }) else { throw Failure.invalid("The requested container is unavailable.") }; return c }
  private func eventChange(_ payload: [String: JSONValue]) throws -> [String: JSONValue] { guard let change = payload["change"], case .object(let value) = change else { throw Failure.invalid("Invalid calendar change.") }; return value }
  private func eventFields(_ change: [String: JSONValue]) throws -> (String, Date, Date, Bool, String, String) {
    let title = try text(change, "title", 500); let startText = try text(change, "start"); let endText = try text(change, "end")
    let start = try instant(startText, field: "start"); let end = try instant(endText, field: "end")
    guard end > start else { throw Failure.invalid("Invalid arguments \"start\" and \"end\": \"end\" must be later than \"start\".") }
    guard case .bool(let allDay) = change["allDay"] else { throw Failure.invalid("Invalid allDay.") }
    let location = change["location"]?.string ?? ""; let notes = change["notes"]?.string ?? ""
    guard location.utf8.count <= 2_000, notes.utf8.count <= 32_000 else { throw Failure.invalid("Event text is too long.") }
    return (title, start, end, allDay, location, notes)
  }
  private func verify(_ event: EKEvent, id: String, calendarId: String, expected: (String, Date, Date, Bool, String, String)) throws {
    // EventKit normalizes an empty optional string to nil on some calendar accounts. The
    // web schema intentionally normalizes absent text to an empty string, so compare those
    // two equivalent representations without weakening ID, calendar, time, or title checks.
    guard event.eventIdentifier == id, event.calendar.calendarIdentifier == calendarId, event.title == expected.0, event.startDate == expected.1, event.endDate == expected.2, event.isAllDay == expected.3, (event.location ?? "") == expected.4, (event.notes ?? "") == expected.5 else { throw Failure.unknown("Calendar event could not be verified.") }
  }
  private func reminderRows(_ reminders: [EKReminder], listId: String) -> [JSONValue] { reminders.map { r in .object(["id": .string(r.calendarItemIdentifier), "listId": .string(listId), "title": .string(r.title ?? ""), "body": .string(r.notes ?? ""), "completed": .bool(r.isCompleted), "due": dueObject(r.dueDateComponents), "recurring": .bool(r.recurrenceRules?.isEmpty == false)]) } }
  private func fetch(_ predicate: NSPredicate) throws -> [EKReminder] { let sem = DispatchSemaphore(value: 0); var result: Result<[EKReminder], Error> = .failure(Failure.unavailable("Reminder query did not complete.")); store.fetchReminders(matching: predicate) { reminders in result = .success(reminders ?? []); sem.signal() }; guard sem.wait(timeout: .now() + 30) == .success else { throw Failure.unavailable("Reminder query timed out.") }; return try result.get() }
  private func requestAccess(_ entity: EKEntityType) throws { let sem = DispatchSemaphore(value: 0); let result = AccessResult(); let completion: @Sendable (Bool, Error?) -> Void = { granted, error in result.set(error.map(Result.failure) ?? .success(granted)); sem.signal() }; if entity == .event { store.requestFullAccessToEvents(completion: completion) } else { store.requestFullAccessToReminders(completion: completion) }; guard sem.wait(timeout: .now() + 60) == .success else { throw Failure.unavailable("Authorization request timed out.") }; guard try result.get().get() else { throw Failure.denied("Full EventKit access was not granted.") } }
  func run(_ request: Request) throws -> JSONValue {
    switch request.action {
    case "hello": return .object(["helperVersion": .string(helperVersion), "protocolVersion": .number(Double(protocolVersion)), "actions": .array(["permissions.status", "permissions.request", "calendar.listCalendars", "calendar.listEvents", "calendar.createVerified", "calendar.updateVerified", "calendar.deleteVerified", "reminders.listLists", "reminders.list", "reminders.preflight", "reminders.createVerified", "reminders.updateVerified", "reminders.patchVerified", "reminders.completeVerified", "reminders.deleteVerified", "diagnostics.remindersABDelete", "diagnostics.recurrenceProbe", "diagnostics.recurrenceProbeDelete"].map(JSONValue.string))])
    case "permissions.status": return .object(["calendar": access(.event), "reminders": access(.reminder)])
    case "permissions.request": let provider = try text(request.payload, "provider"); guard provider == "calendar" || provider == "reminders" else { throw Failure.invalid("Unsupported permission provider.") }; try requestAccess(provider == "calendar" ? EKEntityType.event : EKEntityType.reminder); return .object(["calendar": access(.event), "reminders": access(.reminder)])
    case "calendar.listCalendars":
      try require(.event); guard let rawIds = request.payload["containerIds"], case .array(let values) = rawIds else { throw Failure.invalid("Invalid containerIds.") }; let wanted = Set(values.compactMap(\.string)); return .array(store.calendars(for: .event).filter { wanted.isEmpty || wanted.contains($0.calendarIdentifier) || wanted.contains($0.title) }.map { .object(["id": .string($0.calendarIdentifier), "name": .string($0.title)]) })
    case "calendar.listEvents":
      try require(.event); let id = try text(request.payload, "calendarId"); let from = try text(request.payload, "from"); let to = try text(request.payload, "to"); let start = try instant(from, field: "from"); let end = try instant(to, field: "to"); guard end > start else { throw Failure.invalid("Invalid arguments \"from\" and \"to\": \"to\" must be later than \"from\".") }; let offset = request.payload["offset"]?.int ?? 0; let limit = min(request.payload["limit"]?.int ?? 50, 100); let c = try calendar(id, entity: .event); let events = store.events(matching: store.predicateForEvents(withStart: start, end: end, calendars: [c])).sorted { $0.startDate < $1.startDate }; let rows = events.dropFirst(offset).prefix(limit).map { e in JSONValue.object(["id": .string(e.eventIdentifier), "calendarId": .string(id), "title": .string(e.title ?? ""), "start": .string(isoOutput.string(from: e.startDate)), "end": .string(isoOutput.string(from: e.endDate)), "allDay": .bool(e.isAllDay), "location": .string(e.location ?? ""), "notes": .string(e.notes ?? "")]) }; return .object(["items": .array(rows), "nextOffset": offset + rows.count < events.count ? .number(Double(offset + rows.count)) : .null])
    case "calendar.createVerified":
      try require(.event); let change = try eventChange(request.payload); let calendarId = try text(change, "containerId"); let c = try calendar(calendarId, entity: .event); guard c.allowsContentModifications else { throw Failure.denied("The requested calendar is not writable.") }; let fields = try eventFields(change); let event = EKEvent(eventStore: store); event.calendar = c; event.title = fields.0; event.startDate = fields.1; event.endDate = fields.2; event.isAllDay = fields.3; event.location = fields.4; event.notes = fields.5; try store.save(event, span: .thisEvent, commit: true); guard let id = event.eventIdentifier, let saved = store.event(withIdentifier: id) else { throw Failure.unknown("Calendar event could not be reread after saving.") }; try verify(saved, id: id, calendarId: calendarId, expected: fields); return .object(["id": .string(id), "containerId": .string(calendarId)])
    case "calendar.updateVerified":
      try require(.event); let change = try eventChange(request.payload); let calendarId = try text(change, "containerId"); let id = try text(change, "id"); let c = try calendar(calendarId, entity: .event); guard c.allowsContentModifications else { throw Failure.denied("The requested calendar is not writable.") }; guard let event = store.event(withIdentifier: id), event.calendar.calendarIdentifier == calendarId else { throw Failure.invalid("The requested calendar event is unavailable in this calendar.") }; guard event.recurrenceRules?.isEmpty != false else { throw Failure.invalid("Recurring calendar events cannot be edited.") }; let fields = try eventFields(change); event.title = fields.0; event.startDate = fields.1; event.endDate = fields.2; event.isAllDay = fields.3; event.location = fields.4; event.notes = fields.5; try store.save(event, span: .thisEvent, commit: true); guard let saved = store.event(withIdentifier: id) else { throw Failure.unknown("Calendar event could not be reread after updating.") }; try verify(saved, id: id, calendarId: calendarId, expected: fields); return .object(["id": .string(id), "containerId": .string(calendarId)])
    case "calendar.deleteVerified":
      try require(.event); let change = try eventChange(request.payload); let calendarId = try text(change, "containerId"); let id = try text(change, "id"); let c = try calendar(calendarId, entity: .event); guard c.allowsContentModifications else { throw Failure.denied("The requested calendar is not writable.") }; guard let event = store.event(withIdentifier: id), event.calendar.calendarIdentifier == calendarId else { throw Failure.invalid("The requested calendar event is unavailable in this calendar.") }; guard event.recurrenceRules?.isEmpty != false else { throw Failure.invalid("Recurring calendar events cannot be deleted.") }; try store.remove(event, span: .thisEvent, commit: true); guard store.event(withIdentifier: id) == nil else { throw Failure.unknown("Calendar event deletion could not be verified.") }; return .object(["id": .string(id), "containerId": .string(calendarId)])
    case "reminders.listLists":
      try require(.reminder); guard let rawIds = request.payload["containerIds"], case .array(let values) = rawIds else { throw Failure.invalid("Invalid containerIds.") }; let wanted = Set(values.compactMap(\.string)); return .array(store.calendars(for: .reminder).filter { wanted.isEmpty || wanted.contains($0.calendarIdentifier) || wanted.contains($0.title) }.map { .object(["id": .string($0.calendarIdentifier), "name": .string($0.title)]) })
    case "reminders.list":
      try require(.reminder); let id = try text(request.payload, "listId"); let c = try calendar(id, entity: .reminder); let all = try fetch(store.predicateForReminders(in: [c])).sorted { $0.calendarItemIdentifier < $1.calendarItemIdentifier }; let offset = request.payload["offset"]?.int ?? 0; let limit = min(request.payload["limit"]?.int ?? 50, 100); let page = Array(all.dropFirst(offset).prefix(limit)); return .object(["items": .array(reminderRows(page, listId: id)), "nextOffset": offset + page.count < all.count ? .number(Double(offset + page.count)) : .null])
    case "reminders.preflight": try require(.reminder); let c = try calendar(try text(request.payload, "containerId"), entity: .reminder); guard c.allowsContentModifications else { throw Failure.denied("The requested Reminders list is not writable.") }; return .object([:])
    case "reminders.createVerified":
      let actionStarted = Date()
      try require(.reminder)
      let permissionCheckedAt = Date()
      guard let rawChange = request.payload["change"], case .object(let change) = rawChange else { throw Failure.invalid("Invalid reminder change.") }
      let listId = try text(change, "containerId")
      let c = try calendar(listId, entity: .reminder)
      guard c.allowsContentModifications else { throw Failure.denied("The requested Reminders list is not writable.") }
      let containerResolvedAt = Date()
      let r = EKReminder(eventStore: store)
      r.calendar = c
      r.title = try text(change, "title", 500)
      r.notes = change["body"]?.string ?? ""
      if let rawDue = change["due"] {
        let due = try dueComponents(rawDue)
        // EventKit only carries the due time zone into an existing reminder when the
        // item-level time zone is set explicitly after the components (verified on macOS).
        r.dueDateComponents = due
        r.timeZone = due?.timeZone
      }
      let reminderBuiltAt = Date()
      try store.save(r, commit: true)
      let savedAt = Date()
      guard let saved = store.calendarItem(withIdentifier: r.calendarItemIdentifier) as? EKReminder,
            saved.calendar.calendarIdentifier == listId,
            saved.title == r.title,
            saved.notes == r.notes,
            dueEqual(saved.dueDateComponents, r.dueDateComponents) else { throw Failure.unknown("Reminder could not be verified after saving.") }
      let verifiedAt = Date()
      return .object([
        "id": .string(saved.calendarItemIdentifier),
        "containerId": .string(listId),
        "timings": .object([
          "permissionMs": .number(permissionCheckedAt.timeIntervalSince(actionStarted) * 1000),
          "resolveContainerMs": .number(containerResolvedAt.timeIntervalSince(permissionCheckedAt) * 1000),
          "buildMs": .number(reminderBuiltAt.timeIntervalSince(containerResolvedAt) * 1000),
          "saveMs": .number(savedAt.timeIntervalSince(reminderBuiltAt) * 1000),
          "verifyMs": .number(verifiedAt.timeIntervalSince(savedAt) * 1000),
          "totalMs": .number(verifiedAt.timeIntervalSince(actionStarted) * 1000)
        ])
      ])
    case "reminders.updateVerified":
      try require(.reminder)
      guard let rawChange = request.payload["change"], case .object(let change) = rawChange else { throw Failure.invalid("Invalid reminder change.") }
      let listId = try text(change, "containerId")
      let nativeId = try text(change, "id")
      let c = try calendar(listId, entity: .reminder)
      guard c.allowsContentModifications else { throw Failure.denied("The requested Reminders list is not writable.") }
      guard let reminder = store.calendarItem(withIdentifier: nativeId) as? EKReminder,
            reminder.calendar.calendarIdentifier == listId else { throw Failure.invalid("The requested reminder is unavailable in this list.") }
      guard reminder.recurrenceRules?.isEmpty != false else { throw Failure.unsupported("Recurring reminders cannot be edited.") }
      reminder.title = try text(change, "title", 500)
      reminder.notes = change["body"]?.string ?? ""
      guard case .bool(let completed) = change["completed"] else { throw Failure.invalid("Invalid completed.") }
      reminder.isCompleted = completed
      try store.save(reminder, commit: true)
      guard let saved = store.calendarItem(withIdentifier: nativeId) as? EKReminder,
            saved.calendar.calendarIdentifier == listId,
            saved.title == reminder.title,
            saved.notes == reminder.notes,
            saved.isCompleted == reminder.isCompleted else { throw Failure.unknown("Reminder could not be verified after updating.") }
      return .object(["id": .string(nativeId), "containerId": .string(listId)])
    case "reminders.patchVerified":
      try require(.reminder)
      guard let rawChange = request.payload["change"], case .object(let change) = rawChange else { throw Failure.invalid("Invalid reminder change.") }
      let listId = try text(change, "containerId")
      let nativeId = try text(change, "id")
      let c = try calendar(listId, entity: .reminder)
      guard c.allowsContentModifications else { throw Failure.denied("The requested Reminders list is not writable.") }
      guard let reminder = store.calendarItem(withIdentifier: nativeId) as? EKReminder,
            reminder.calendar.calendarIdentifier == listId else { throw Failure.invalid("The requested reminder is unavailable in this list.") }
      guard reminder.recurrenceRules?.isEmpty != false else { throw Failure.unsupported("Recurring reminders cannot be patched.") }
      let hasTitle = change["title"] != nil
      let hasBody = change["body"] != nil
      let hasDue = change["due"] != nil
      let hasCompleted = change["completed"] != nil
      guard hasTitle || hasBody || hasDue || hasCompleted else { throw Failure.invalid("At least one reminder field must be changed.") }
      let originalTitle = reminder.title ?? ""
      let originalNotes = reminder.notes ?? ""
      let originalCompleted = reminder.isCompleted
      let originalDue = reminder.dueDateComponents
      if hasTitle { reminder.title = try text(change, "title", 500) }
      if hasBody {
        guard let body = change["body"]?.string, body.utf8.count <= 32_000 else { throw Failure.invalid("Invalid body.") }
        reminder.notes = body
      }
      if hasCompleted {
        guard case .bool(let completed) = change["completed"] else { throw Failure.invalid("Invalid completed.") }
        reminder.isCompleted = completed
      }
      if hasDue {
        let due = try dueComponents(change["due"]!)
        // Set the item-level zone after the components so a date-only/floating item
        // promoted to a zoned instant does not silently lose its time zone.
        reminder.dueDateComponents = due
        reminder.timeZone = due?.timeZone
      }
      let expectedTitle = hasTitle ? (reminder.title ?? "") : originalTitle
      let expectedNotes = hasBody ? (reminder.notes ?? "") : originalNotes
      let expectedCompleted = hasCompleted ? reminder.isCompleted : originalCompleted
      let expectedDue = hasDue ? reminder.dueDateComponents : originalDue
      try store.save(reminder, commit: true)
      guard let saved = store.calendarItem(withIdentifier: nativeId) as? EKReminder,
            saved.calendar.calendarIdentifier == listId,
            saved.calendarItemIdentifier == nativeId,
            saved.title == expectedTitle,
            (saved.notes ?? "") == expectedNotes,
            saved.isCompleted == expectedCompleted,
            dueEqual(saved.dueDateComponents, expectedDue) else { throw Failure.unknown("Reminder could not be verified after patching.") }
      return .object(["id": .string(saved.calendarItemIdentifier), "containerId": .string(listId)])
    case "reminders.completeVerified":
      try require(.reminder)
      guard let rawChange = request.payload["change"], case .object(let change) = rawChange else { throw Failure.invalid("Invalid reminder change.") }
      let listId = try text(change, "containerId")
      let nativeId = try text(change, "id")
      let c = try calendar(listId, entity: .reminder)
      guard c.allowsContentModifications else { throw Failure.denied("The requested Reminders list is not writable.") }
      guard let reminder = store.calendarItem(withIdentifier: nativeId) as? EKReminder,
            reminder.calendar.calendarIdentifier == listId else { throw Failure.invalid("The requested reminder is unavailable in this list.") }
      guard reminder.recurrenceRules?.isEmpty != false else { throw Failure.unsupported("Recurring reminders cannot be completed.") }
      reminder.isCompleted = true
      try store.save(reminder, commit: true)
      guard let saved = store.calendarItem(withIdentifier: nativeId) as? EKReminder,
            saved.calendar.calendarIdentifier == listId,
            saved.isCompleted else { throw Failure.unknown("Reminder completion could not be verified.") }
      return .object(["id": .string(nativeId), "containerId": .string(listId)])
    case "reminders.deleteVerified":
      try require(.reminder)
      guard let rawChange = request.payload["change"], case .object(let change) = rawChange else { throw Failure.invalid("Invalid reminder change.") }
      let listId = try text(change, "containerId")
      let nativeId = try text(change, "id")
      let c = try calendar(listId, entity: .reminder)
      guard c.allowsContentModifications else { throw Failure.denied("The requested Reminders list is not writable.") }
      guard let reminder = store.calendarItem(withIdentifier: nativeId) as? EKReminder,
            reminder.calendar.calendarIdentifier == listId else { throw Failure.invalid("The requested reminder is unavailable in this list.") }
      guard reminder.recurrenceRules?.isEmpty != false else { throw Failure.unsupported("Recurring reminders cannot be deleted.") }
      try store.remove(reminder, commit: true)
      guard store.calendarItem(withIdentifier: nativeId) == nil else { throw Failure.unknown("Reminder deletion could not be verified.") }
      return .object(["id": .string(nativeId), "containerId": .string(listId)])
    case "diagnostics.remindersABDelete":
      try require(.reminder)
      let listId = try text(request.payload, "containerId")
      let nativeId = try text(request.payload, "nativeId")
      let probeId = try text(request.payload, "probeId", 36)
      guard UUID(uuidString: probeId) != nil else { throw Failure.invalid("Invalid probe ID.") }
      let c = try calendar(listId, entity: .reminder)
      guard c.allowsContentModifications else { throw Failure.denied("The requested Reminders list is not writable.") }
      guard let reminder = store.calendarItem(withIdentifier: nativeId) as? EKReminder,
            reminder.calendar.calendarIdentifier == listId,
            reminder.title == "Apple Connector AB Probe \(probeId)" else { throw Failure.invalid("The exact A/B probe reminder is unavailable.") }
      try store.remove(reminder, commit: true)
      guard store.calendarItem(withIdentifier: nativeId) == nil else { throw Failure.unknown("A/B probe cleanup could not be verified.") }
      return .object(["removed": .bool(true), "id": .string(nativeId)])
    case "diagnostics.recurrenceProbe":
      try require(.reminder)
      let listId = try text(request.payload, "containerId")
      let probeTitle = try text(request.payload, "title", 500)
      guard probeTitle.hasPrefix("Apple Connector Recurring Probe ") else { throw Failure.invalid("Invalid recurring probe title.") }
      let c = try calendar(listId, entity: .reminder)
      guard c.allowsContentModifications else { throw Failure.denied("The requested Reminders list is not writable.") }
      let probe = EKReminder(eventStore: store)
      probe.calendar = c
      probe.title = probeTitle
      // EventKit rejects a repeating reminder that has no due date.
      probe.dueDateComponents = DateComponents(calendar: gregorian(), year: 2032, month: 9, day: 1)
      probe.addRecurrenceRule(EKRecurrenceRule(recurrenceWith: .daily, interval: 1, end: nil))
      try store.save(probe, commit: true)
      guard let saved = store.calendarItem(withIdentifier: probe.calendarItemIdentifier) as? EKReminder,
            saved.calendar.calendarIdentifier == listId,
            saved.recurrenceRules?.isEmpty == false else { throw Failure.unknown("Recurring probe could not be verified.") }
      return .object(["id": .string(saved.calendarItemIdentifier), "containerId": .string(listId), "recurring": .bool(true)])
    case "diagnostics.recurrenceProbeDelete":
      try require(.reminder)
      let listId = try text(request.payload, "containerId")
      let nativeId = try text(request.payload, "id")
      let c = try calendar(listId, entity: .reminder)
      guard c.allowsContentModifications else { throw Failure.denied("The requested Reminders list is not writable.") }
      guard let reminder = store.calendarItem(withIdentifier: nativeId) as? EKReminder,
            reminder.calendar.calendarIdentifier == listId,
            (reminder.title ?? "").hasPrefix("Apple Connector Recurring Probe ") else { throw Failure.invalid("The exact recurring probe is unavailable.") }
      try store.remove(reminder, commit: true)
      guard store.calendarItem(withIdentifier: nativeId) == nil else { throw Failure.unknown("Recurring probe cleanup could not be verified.") }
      return .object(["removed": .bool(true), "id": .string(nativeId)])
    default: throw Failure.invalid("Unsupported helper action.")
    }
  }
}

func handle(_ line: String, helper: Helper, decoder: JSONDecoder, encoder: JSONEncoder) -> String {
  var requestId = ""
  let response: Response
  if line.utf8.count > maxLineBytes {
    response = Response(id: requestId, ok: false, result: nil, error: HelperError(code: "protocol_error", message: "Request exceeds maximum size."))
  } else {
    do {
      let request = try decoder.decode(Request.self, from: Data(line.utf8))
      requestId = request.id
      guard request.version == protocolVersion, request.id.count <= 128 else { throw Failure.invalid("Unsupported protocol version or request ID.") }
      response = Response(id: request.id, ok: true, result: try helper.run(request), error: nil)
    } catch let error as Failure {
      let value: HelperError
      switch error {
      case .invalid(let m): value = HelperError(code: "invalid_request", message: m)
      case .denied(let m): value = HelperError(code: "permission_denied", message: m)
      case .unsupported(let m): value = HelperError(code: "unsupported_operation", message: m)
      case .unavailable(let m): value = HelperError(code: "service_unavailable", message: m)
      case .unknown(let m): value = HelperError(code: "outcome_unknown", message: m)
      }
      response = Response(id: requestId, ok: false, result: nil, error: value)
    } catch {
      response = Response(id: requestId, ok: false, result: nil, error: HelperError(code: "protocol_error", message: "Malformed helper request."))
    }
  }
  guard let data = try? encoder.encode(response), let output = String(data: data, encoding: .utf8) else { return "" }
  return output
}

let helper = Helper()
let decoder = JSONDecoder()
let encoder = JSONEncoder()

if let socketIndex = CommandLine.arguments.firstIndex(of: "--socket") {
  guard socketIndex + 1 < CommandLine.arguments.count else {
    FileHandle.standardError.write(Data("Missing value for --socket.\n".utf8))
    exit(2)
  }
  let socketPath = CommandLine.arguments[socketIndex + 1]
  do {
    try runSocketServer(path: socketPath) { line in
      autoreleasepool { handle(line, helper: helper, decoder: decoder, encoder: encoder) }
    }
  } catch {
    appendHelperLog(directory: (socketPath as NSString).deletingLastPathComponent, message: "fatal: \(error)\n")
    FileHandle.standardError.write(Data("apple-connector-helper: \(error)\n".utf8))
    exit(1)
  }
  exit(0)
}

// This process is long-lived. Foundation and EventKit create autoreleased bridge
// objects on every request, so each iteration must drain its own pool instead of
// accumulating them until the helper exits.
while let line = readLine(strippingNewline: true) {
  autoreleasepool {
    print(handle(line, helper: helper, decoder: decoder, encoder: encoder))
    fflush(stdout)
  }
}
