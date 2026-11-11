// Hob's Mac helper for Calendar: the calendars this Mac already has (iCloud, Google, Exchange… added in
// System Settings → Internet Accounts), through EventKit. Prints JSON; errors go to stderr with exit 1.
//   hob-mac calendar-status                → {"status":"granted"|"denied"|"notDetermined"}
//   hob-mac calendar-auth                  → asks once (the system's own prompt), then the status
//   hob-mac calendars                      → [{"name","account","writable","color"}]
//   hob-mac events FROM TO [QUERY]         → events between two ISO dates, optionally matching words
//   hob-mac add-event JSON                 → {"title","start","end","calendar"?,"location"?,"notes"?,"allDay"?}
//   hob-mac reminder-status                → {"status":"granted"|"denied"|"notDetermined"}
//   hob-mac reminder-auth                  → asks once (the system's own prompt), then the status
//   hob-mac reminders JSON                → [{"title","list","due"?,"notes"?}]; JSON: {"query"?,"includeCompleted"?,"completedSince"?}; completed ones come last with "completed": true, "completedOn"?
//   hob-mac add-reminder JSON              → {"title","due"?,"list"?,"notes"?,"url"?,"priority"?,"repeat"?,"repeatEvery"?,"alarm"?}; asks for Reminders access the first time
//   hob-mac update-reminder JSON           → {"id", …the same fields, "completed"?}; "" clears due/notes/url, repeat "none" stops repeating
//   hob-mac delete-reminder JSON           → {"id"}
//   hob-mac mail-status | mail-auth        → may Hob talk to the Mail app? (mail-auth opens Mail and asks once)
//   hob-mac notes-status | notes-auth      → the same for the Notes app
import AppKit
import EventKit
import Foundation

let store = EKEventStore()
let iso = ISO8601DateFormatter()
iso.formatOptions = [.withInternetDateTime]
let dayIso = ISO8601DateFormatter()
dayIso.formatOptions = [.withFullDate]

func out(_ v: Any) { FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject: v, options: [.sortedKeys])); print() }
func fail(_ msg: String) -> Never { FileHandle.standardError.write((msg + "\n").data(using: .utf8)!); exit(1) }
func date(_ s: String) -> Date {
  if let d = iso.date(from: s) { return d }
  if let d = dayIso.date(from: s) { return d }
  // local time without a zone: "2026-10-21T15:00:00"
  let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = .current
  for p in ["yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd'T'HH:mm", "yyyy-MM-dd HH:mm"] { f.dateFormat = p; if let d = f.date(from: s) { return d } }
  fail("Couldn't read the date \"\(s)\". Use a form like 2026-10-21T15:00:00.")
}

func status() -> String {
  let s = EKEventStore.authorizationStatus(for: .event)
  if #available(macOS 14.0, *) { if s == .fullAccess { return "granted" } }
  switch s {
  case .authorized: return "granted"
  case .notDetermined: return "notDetermined"
  default: return "denied"
  }
}

func needAccess() { if status() != "granted" { fail("Hob doesn't have access to Calendar yet. Allow it in System Settings → Privacy & Security → Calendars.") } }

func reminderStatus() -> String {
  let s = EKEventStore.authorizationStatus(for: .reminder)
  if #available(macOS 14.0, *) { if s == .fullAccess { return "granted" } }
  switch s {
  case .authorized: return "granted"
  case .notDetermined: return "notDetermined"
  default: return "denied"
  }
}

func requestReminderAccess() {
  if reminderStatus() != "granted" {
    let done = DispatchSemaphore(value: 0)
    if #available(macOS 14.0, *) { store.requestFullAccessToReminders { _, _ in done.signal() } }
    else { store.requestAccess(to: .reminder) { _, _ in done.signal() } }
    _ = done.wait(timeout: .now() + 120)
  }
}

func needReminderAccess() {
  requestReminderAccess()
  if reminderStatus() != "granted" { fail("Hob doesn't have access to Reminders. Allow it in System Settings → Privacy & Security → Reminders.") }
}

let args = Array(CommandLine.arguments.dropFirst())

let priorityNames: [String: Int] = ["high": 1, "medium": 5, "low": 9, "none": 0]
let repeatFrequencies: [String: EKRecurrenceFrequency] = ["daily": .daily, "weekly": .weekly, "monthly": .monthly, "yearly": .yearly]

func dueDate(_ r: EKReminder) -> Date? { r.dueDateComponents.flatMap { Calendar.current.date(from: $0) } }

func describe(_ r: EKReminder) -> [String: Any] {
  var o: [String: Any] = ["id": r.calendarItemIdentifier, "title": r.title ?? "(no title)", "list": r.calendar.title, "completed": r.isCompleted]
  if let d = r.completionDate { o["completedOn"] = iso.string(from: d) }
  if let n = r.notes, !n.isEmpty { o["notes"] = String(n.prefix(1000)) }
  if let d = dueDate(r) { o["due"] = iso.string(from: d) }
  if let u = r.url { o["url"] = u.absoluteString }
  if let p = priorityNames.first(where: { $0.value == r.priority && $0.value != 0 })?.key { o["priority"] = p }
  if let rule = r.recurrenceRules?.first, let f = repeatFrequencies.first(where: { $0.value == rule.frequency })?.key {
    o["repeat"] = f
    if rule.interval > 1 { o["repeatEvery"] = rule.interval }
  }
  return o
}

/// the fields shared by add and update; fails with a plain message before anything is saved
func applyReminder(_ r: EKReminder, _ j: [String: Any]) {
  if let t = j["title"] as? String { if t.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { fail("A reminder needs a title.") }; r.title = t }
  if let n = j["notes"] as? String { r.notes = n.isEmpty ? nil : n }
  if let u = j["url"] as? String {
    if u.isEmpty { r.url = nil } else if let url = URL(string: u), url.scheme != nil { r.url = url } else { fail("Couldn't read the link \"\(u)\".") }
  }
  if let p = j["priority"] as? String {
    guard let v = priorityNames[p.lowercased()] else { fail("priority must be high, medium, low or none.") }
    r.priority = v
  }
  if let due = j["due"] as? String {
    if due.isEmpty { r.dueDateComponents = nil } else {
      var c = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: date(due))
      c.timeZone = .current
      r.dueDateComponents = c
    }
  }
  if let rep = j["repeat"] as? String {
    for rule in r.recurrenceRules ?? [] { r.removeRecurrenceRule(rule) }
    if !rep.isEmpty && rep.lowercased() != "none" {
      guard let f = repeatFrequencies[rep.lowercased()] else { fail("repeat must be daily, weekly, monthly, yearly or none.") }
      let every = (j["repeatEvery"] as? Int) ?? 1
      if every < 1 { fail("repeatEvery must be 1 or more.") }
      r.addRecurrenceRule(EKRecurrenceRule(recurrenceWith: f, interval: every, end: nil))
    }
  }
  if !(r.recurrenceRules ?? []).isEmpty && r.dueDateComponents == nil { fail("A repeating reminder needs a due date.") }
  // a due time alone is silent in Reminders: add the alert unless asked not to
  if j["due"] != nil || j["alarm"] != nil {
    for a in r.alarms ?? [] where a.absoluteDate != nil { r.removeAlarm(a) }
    if (j["alarm"] as? Bool) ?? true, let d = dueDate(r) { r.addAlarm(EKAlarm(absoluteDate: d)) }
  }
}

func reminderLists() -> [EKCalendar] { store.calendars(for: .reminder).filter { $0.allowsContentModifications } }

func reminderJSON(_ name: String) -> [String: Any] {
  guard args.count >= 2, let data = args[1].data(using: .utf8), let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { fail("\(name) needs JSON options") }
  return j
}

func findReminder(_ j: [String: Any]) -> EKReminder {
  guard let id = j["id"] as? String, let r = store.calendarItem(withIdentifier: id) as? EKReminder else { fail("Couldn't find that reminder. List the reminders again and use the id shown there.") }
  return r
}


switch args.first {
case "calendar-status":
  out(["status": status()])
case "calendar-auth":
  let done = DispatchSemaphore(value: 0)
  if #available(macOS 14.0, *) { store.requestFullAccessToEvents { _, _ in done.signal() } }
  else { store.requestAccess(to: .event) { _, _ in done.signal() } }
  _ = done.wait(timeout: .now() + 120)
  out(["status": status()])
case "calendars":
  needAccess()
  out(store.calendars(for: .event).map { c in
    ["name": c.title, "account": c.source.title, "writable": c.allowsContentModifications] as [String: Any]
  })
case "events":
  needAccess()
  guard args.count >= 3 else { fail("events FROM TO [QUERY]") }
  let from = date(args[1]), to = date(args[2])
  let words = args.count > 3 ? args[3].lowercased().split(separator: " ").map(String.init) : []
  let found = store.events(matching: store.predicateForEvents(withStart: from, end: to, calendars: nil))
    .filter { e in words.isEmpty || words.allSatisfy { w in [e.title, e.location, e.notes].compactMap { $0?.lowercased() }.contains { $0.contains(w) } } }
    .sorted { $0.startDate < $1.startDate }
    .prefix(200)
  out(found.map { e in
    var o: [String: Any] = ["title": e.title ?? "(no title)", "start": iso.string(from: e.startDate), "end": iso.string(from: e.endDate), "allDay": e.isAllDay, "calendar": e.calendar.title]
    if let l = e.location, !l.isEmpty { o["location"] = l }
    if let n = e.notes, !n.isEmpty { o["notes"] = String(n.prefix(500)) }
    if let a = e.attendees, !a.isEmpty { o["attendees"] = a.compactMap { $0.name }.prefix(20).map { $0 } }
    return o
  })
case "add-event":
  needAccess()
  guard args.count >= 2, let data = args[1].data(using: .utf8), let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let title = j["title"] as? String, let start = j["start"] as? String else { fail("add-event needs a title and a start") }
  let e = EKEvent(eventStore: store)
  e.title = title
  e.startDate = date(start)
  e.isAllDay = (j["allDay"] as? Bool) ?? false
  e.endDate = (j["end"] as? String).map(date) ?? e.startDate.addingTimeInterval(3600)
  if let l = j["location"] as? String { e.location = l }
  if let n = j["notes"] as? String { e.notes = n }
  let name = j["calendar"] as? String
  let writable = store.calendars(for: .event).filter { $0.allowsContentModifications }
  guard let cal = (name.flatMap { n in writable.first { $0.title.lowercased() == n.lowercased() } }) ?? store.defaultCalendarForNewEvents ?? writable.first else {
    fail("There's no calendar Hob can add events to.")
  }
  e.calendar = cal
  do { try store.save(e, span: .thisEvent, commit: true) } catch { fail("Couldn't add the event: \(error.localizedDescription)") }
  out(["title": title, "start": iso.string(from: e.startDate), "end": iso.string(from: e.endDate), "calendar": cal.title])
case "reminder-status": out(["status": reminderStatus()])
case "reminder-auth":
  requestReminderAccess()
  out(["status": reminderStatus()])
case "reminders":
  needReminderAccess()
  guard args.count >= 2, let data = args[1].data(using: .utf8), let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { fail("reminders needs JSON options") }
  let query = (j["query"] as? String ?? "").lowercased()
  let predicate = (j["includeCompleted"] as? Bool ?? false)
    ? store.predicateForReminders(in: nil)
    : store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: nil)
  let fetched = DispatchSemaphore(value: 0)
  var found: [EKReminder] = []
  store.fetchReminders(matching: predicate) { r in found = r ?? []; fetched.signal() }
  _ = fetched.wait(timeout: .now() + 60)
  let since = (j["completedSince"] as? String).map { date($0) }
  let matches = found.filter { r in
    (query.isEmpty || r.title.lowercased().contains(query) || (r.notes ?? "").lowercased().contains(query))
      && (since == nil || !r.isCompleted || (r.completionDate ?? .distantPast) >= since!)
  }
  // open ones first, soonest due first (undated last); then completed ones, most recently completed first
  let open = matches.filter { !$0.isCompleted }.sorted { (dueDate($0) ?? .distantFuture) < (dueDate($1) ?? .distantFuture) }
  let done = matches.filter { $0.isCompleted }.sorted { ($0.completionDate ?? .distantPast) > ($1.completionDate ?? .distantPast) }
  out((open + done)
    .prefix(200).map(describe))
case "add-reminder":
  let j = reminderJSON("add-reminder")
  guard let title = j["title"] as? String, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { fail("add-reminder needs a title") }
  let r = EKReminder(eventStore: store)
  applyReminder(r, j)
  needReminderAccess()
  let name = j["list"] as? String
  let lists = reminderLists()
  guard let list = (name.flatMap { n in lists.first { $0.title.lowercased() == n.lowercased() } }) ?? store.defaultCalendarForNewReminders() ?? lists.first else {
    fail("There's no reminders list Hob can add reminders to.")
  }
  r.calendar = list
  do { try store.save(r, commit: true) } catch { fail("Couldn't add the reminder: \(error.localizedDescription)") }
  out(describe(r))
case "update-reminder":
  let j = reminderJSON("update-reminder")
  needReminderAccess()
  let r = findReminder(j)
  applyReminder(r, j)
  if let b = j["completed"] as? Bool { r.isCompleted = b }
  if let n = j["list"] as? String {
    guard let list = reminderLists().first(where: { $0.title.lowercased() == n.lowercased() }) else { fail("There's no reminders list called \"\(n)\" that Hob can change.") }
    r.calendar = list
  }
  do { try store.save(r, commit: true) } catch { fail("Couldn't change the reminder: \(error.localizedDescription)") }
  out(describe(r))
case "delete-reminder":
  let j = reminderJSON("delete-reminder")
  needReminderAccess()
  let r = findReminder(j)
  let d = describe(r)
  do { try store.remove(r, commit: true) } catch { fail("Couldn't delete the reminder: \(error.localizedDescription)") }
  out(d)
case "mail-status", "mail-auth", "notes-status", "notes-auth":
  let ask = args.first?.hasSuffix("-auth") ?? false
  let bundle = args.first!.hasPrefix("notes") ? "com.apple.Notes" : "com.apple.mail"
  if ask, NSRunningApplication.runningApplications(withBundleIdentifier: bundle).isEmpty, let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundle) {
    let started = DispatchSemaphore(value: 0)
    let cfg = NSWorkspace.OpenConfiguration(); cfg.activates = false
    NSWorkspace.shared.openApplication(at: url, configuration: cfg) { _, _ in started.signal() }
    _ = started.wait(timeout: .now() + 20)
    Thread.sleep(forTimeInterval: 1.5)
  }
  var target = AEAddressDesc()
  let id = bundle.data(using: .utf8)!
  _ = id.withUnsafeBytes { AECreateDesc(typeApplicationBundleID, $0.baseAddress, id.count, &target) }
  let r = AEDeterminePermissionToAutomateTarget(&target, typeWildCard, typeWildCard, ask)
  AEDisposeDesc(&target)
  out(["status": r == noErr ? "granted" : r == OSStatus(errAEEventNotPermitted) ? "denied" : r == OSStatus(procNotFound) ? "notRunning" : "notDetermined"])
default:
  fail("usage: hob-mac calendar-status | calendar-auth | calendars | events FROM TO [QUERY] | add-event JSON | reminders JSON | add-reminder JSON | reminder-status | reminder-auth | mail-status | mail-auth | notes-status | notes-auth")
}
