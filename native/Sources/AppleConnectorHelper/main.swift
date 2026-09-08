import EventKit
import Foundation

let protocolVersion = 1
let maxLineBytes = 1_048_576

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
enum Failure: Error { case invalid(String), denied(String), unavailable(String), unknown(String) }
final class AccessResult: @unchecked Sendable {
  private let lock = NSLock(); private var value: Result<Bool, Error> = .failure(Failure.unavailable("Authorization request did not complete."))
  func set(_ next: Result<Bool, Error>) { lock.lock(); value = next; lock.unlock() }
  func get() -> Result<Bool, Error> { lock.lock(); defer { lock.unlock() }; return value }
}

final class Helper {
  private let store = EKEventStore()
  private let iso = ISO8601DateFormatter()
  init() { iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds] }
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
    guard let start = iso.date(from: startText), let end = iso.date(from: endText), end > start, case .bool(let allDay) = change["allDay"] else { throw Failure.invalid("Invalid event timing.") }
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
  private func reminderRows(_ reminders: [EKReminder], listId: String) -> [JSONValue] { reminders.map { r in .object(["id": .string(r.calendarItemIdentifier), "listId": .string(listId), "title": .string(r.title ?? ""), "body": .string(r.notes ?? ""), "completed": .bool(r.isCompleted), "due": r.dueDateComponents.flatMap { Calendar.current.date(from: $0) }.map { .string(iso.string(from: $0)) } ?? .null]) } }
  private func fetch(_ predicate: NSPredicate) throws -> [EKReminder] { let sem = DispatchSemaphore(value: 0); var result: Result<[EKReminder], Error> = .failure(Failure.unavailable("Reminder query did not complete.")); store.fetchReminders(matching: predicate) { reminders in result = .success(reminders ?? []); sem.signal() }; guard sem.wait(timeout: .now() + 30) == .success else { throw Failure.unavailable("Reminder query timed out.") }; return try result.get() }
  private func requestAccess(_ entity: EKEntityType) throws { let sem = DispatchSemaphore(value: 0); let result = AccessResult(); let completion: @Sendable (Bool, Error?) -> Void = { granted, error in result.set(error.map(Result.failure) ?? .success(granted)); sem.signal() }; if entity == .event { store.requestFullAccessToEvents(completion: completion) } else { store.requestFullAccessToReminders(completion: completion) }; guard sem.wait(timeout: .now() + 60) == .success else { throw Failure.unavailable("Authorization request timed out.") }; guard try result.get().get() else { throw Failure.denied("Full EventKit access was not granted.") } }
  func run(_ request: Request) throws -> JSONValue {
    switch request.action {
    case "hello": return .object(["helperVersion": .string("0.8.3"), "protocolVersion": .number(Double(protocolVersion)), "actions": .array(["permissions.status", "permissions.request", "calendar.listCalendars", "calendar.listEvents", "calendar.createVerified", "calendar.updateVerified", "calendar.deleteVerified", "reminders.listLists", "reminders.list", "reminders.preflight", "reminders.createVerified", "reminders.updateVerified", "reminders.completeVerified", "reminders.deleteVerified", "diagnostics.remindersABDelete"].map(JSONValue.string))])
    case "permissions.status": return .object(["calendar": access(.event), "reminders": access(.reminder)])
    case "permissions.request": let provider = try text(request.payload, "provider"); guard provider == "calendar" || provider == "reminders" else { throw Failure.invalid("Unsupported permission provider.") }; try requestAccess(provider == "calendar" ? EKEntityType.event : EKEntityType.reminder); return .object(["calendar": access(.event), "reminders": access(.reminder)])
    case "calendar.listCalendars":
      try require(.event); guard let rawIds = request.payload["containerIds"], case .array(let values) = rawIds else { throw Failure.invalid("Invalid containerIds.") }; let wanted = Set(values.compactMap(\.string)); return .array(store.calendars(for: .event).filter { wanted.isEmpty || wanted.contains($0.calendarIdentifier) || wanted.contains($0.title) }.map { .object(["id": .string($0.calendarIdentifier), "name": .string($0.title)]) })
    case "calendar.listEvents":
      try require(.event); let id = try text(request.payload, "calendarId"); let from = try text(request.payload, "from"); let to = try text(request.payload, "to"); guard let start = iso.date(from: from), let end = iso.date(from: to), end > start else { throw Failure.invalid("Invalid event range.") }; let offset = request.payload["offset"]?.int ?? 0; let limit = min(request.payload["limit"]?.int ?? 50, 100); let c = try calendar(id, entity: .event); let events = store.events(matching: store.predicateForEvents(withStart: start, end: end, calendars: [c])).sorted { $0.startDate < $1.startDate }; let rows = events.dropFirst(offset).prefix(limit).map { e in JSONValue.object(["id": .string(e.eventIdentifier), "calendarId": .string(id), "title": .string(e.title ?? ""), "start": .string(iso.string(from: e.startDate)), "end": .string(iso.string(from: e.endDate)), "allDay": .bool(e.isAllDay), "location": .string(e.location ?? ""), "notes": .string(e.notes ?? "")]) }; return .object(["items": .array(rows), "nextOffset": offset + rows.count < events.count ? .number(Double(offset + rows.count)) : .null])
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
      if case .object(let due) = change["due"] {
        if due["kind"]?.string == "date", let date = due["date"]?.string {
          let parts = date.split(separator: "-").compactMap { Int($0) }
          guard parts.count == 3 else { throw Failure.invalid("Invalid due date.") }
          r.dueDateComponents = DateComponents(calendar: Calendar.current, year: parts[0], month: parts[1], day: parts[2])
        } else if due["kind"]?.string == "instant", let at = due["at"]?.string, let zoneName = due["timeZone"]?.string, let zone = TimeZone(identifier: zoneName), let moment = iso.date(from: at) {
          var calendar = Calendar(identifier: .gregorian)
          calendar.timeZone = zone
          r.dueDateComponents = calendar.dateComponents(in: zone, from: moment)
        } else { throw Failure.invalid("Invalid due date.") }
      }
      let reminderBuiltAt = Date()
      try store.save(r, commit: true)
      let savedAt = Date()
      guard let saved = store.calendarItem(withIdentifier: r.calendarItemIdentifier) as? EKReminder,
            saved.calendar.calendarIdentifier == listId,
            saved.title == r.title,
            saved.notes == r.notes,
            saved.dueDateComponents == r.dueDateComponents else { throw Failure.unknown("Reminder could not be verified after saving.") }
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
      guard reminder.recurrenceRules?.isEmpty != false else { throw Failure.invalid("Recurring reminders cannot be edited.") }
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
    case "reminders.completeVerified":
      try require(.reminder)
      guard let rawChange = request.payload["change"], case .object(let change) = rawChange else { throw Failure.invalid("Invalid reminder change.") }
      let listId = try text(change, "containerId")
      let nativeId = try text(change, "id")
      let c = try calendar(listId, entity: .reminder)
      guard c.allowsContentModifications else { throw Failure.denied("The requested Reminders list is not writable.") }
      guard let reminder = store.calendarItem(withIdentifier: nativeId) as? EKReminder,
            reminder.calendar.calendarIdentifier == listId else { throw Failure.invalid("The requested reminder is unavailable in this list.") }
      guard reminder.recurrenceRules?.isEmpty != false else { throw Failure.invalid("Recurring reminders cannot be completed.") }
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
      guard reminder.recurrenceRules?.isEmpty != false else { throw Failure.invalid("Recurring reminders cannot be deleted.") }
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
    default: throw Failure.invalid("Unsupported helper action.")
    }
  }
}

let helper = Helper(); let decoder = JSONDecoder(); let encoder = JSONEncoder()
while let line = readLine(strippingNewline: true) { var requestId = ""; let response: Response; if line.utf8.count > maxLineBytes { response = Response(id: requestId, ok: false, result: nil, error: HelperError(code: "protocol_error", message: "Request exceeds maximum size.")) } else { do { let request = try decoder.decode(Request.self, from: Data(line.utf8)); requestId = request.id; guard request.version == protocolVersion, request.id.count <= 128 else { throw Failure.invalid("Unsupported protocol version or request ID.") }; response = Response(id: request.id, ok: true, result: try helper.run(request), error: nil) } catch let error as Failure { let value: HelperError; switch error { case .invalid(let m): value = HelperError(code: "invalid_request", message: m); case .denied(let m): value = HelperError(code: "permission_denied", message: m); case .unavailable(let m): value = HelperError(code: "service_unavailable", message: m); case .unknown(let m): value = HelperError(code: "outcome_unknown", message: m) }; response = Response(id: requestId, ok: false, result: nil, error: value) } catch { response = Response(id: requestId, ok: false, result: nil, error: HelperError(code: "protocol_error", message: "Malformed helper request.")) } }; if let data = try? encoder.encode(response), let output = String(data: data, encoding: .utf8) { print(output); fflush(stdout) } }
