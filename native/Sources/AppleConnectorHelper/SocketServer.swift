import Darwin
import Foundation

enum HelperSocketError: Error, CustomStringConvertible {
  case invalidPath(String)
  case system(String, Int32)

  var description: String {
    switch self {
    case .invalidPath(let path): return "Invalid helper socket path: \(path)"
    case .system(let operation, let code): return "\(operation) failed: \(String(cString: strerror(code)))"
    }
  }
}

func appendHelperLog(directory: String, message: String) {
  let path = (directory as NSString).appendingPathComponent("helper.log")
  let data = Data(message.utf8)
  let manager = FileManager.default
  if !manager.fileExists(atPath: path) {
    _ = manager.createFile(atPath: path, contents: data, attributes: [.posixPermissions: 0o600])
    return
  }
  guard let handle = FileHandle(forWritingAtPath: path) else { return }
  defer { try? handle.close() }
  if let size = try? handle.seekToEnd(), size > 1_048_576 {
    try? handle.truncate(atOffset: 0)
  }
  handle.write(data)
}

private func socketLength(_ bytes: [UInt8]) -> socklen_t {
  let offset = MemoryLayout<sockaddr_un>.offset(of: \.sun_path) ?? 2
  return socklen_t(offset + bytes.count + 1)
}

private func withSockaddr<T>(_ address: inout sockaddr_un, _ body: (UnsafePointer<sockaddr>, socklen_t) -> T) -> T {
  let length = socklen_t(address.sun_len)
  return withUnsafePointer(to: &address) { pointer in
    pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { body($0, length) }
  }
}

private func writeAll(_ descriptor: Int32, _ text: String) -> Bool {
  let data = Data(text.utf8)
  return data.withUnsafeBytes { raw -> Bool in
    guard let base = raw.baseAddress else { return true }
    var offset = 0
    while offset < raw.count {
      let written = write(descriptor, base.advanced(by: offset), raw.count - offset)
      if written < 0 {
        if errno == EINTR { continue }
        return false
      }
      if written == 0 { return false }
      offset += written
    }
    return true
  }
}

private func serve(_ descriptor: Int32, handler: SerializedHandler) {
  var buffer = Data()
  var chunk = [UInt8](repeating: 0, count: 64 * 1024)
  while true {
    let count = read(descriptor, &chunk, chunk.count)
    if count == 0 { return }
    if count < 0 {
      if errno == EINTR { continue }
      return
    }
    buffer.append(chunk, count: count)
    if buffer.count > maxLineBytes * 2 { return }
    while let newline = buffer.firstIndex(of: 0x0A) {
      let lineData = buffer[buffer.startIndex..<newline]
      buffer.removeSubrange(buffer.startIndex...newline)
      let line = String(decoding: lineData, as: UTF8.self)
      let response = handler.call(line)
      guard writeAll(descriptor, "\(response)\n") else { return }
    }
  }
}

/// EventKit is used from one request at a time, while several clients (the Node
/// service, doctor, tests) may keep idle connections open concurrently.
private final class SerializedHandler: @unchecked Sendable {
  private let lock = NSLock()
  private let handle: (String) -> String
  init(_ handle: @escaping (String) -> String) { self.handle = handle }
  func call(_ line: String) -> String {
    lock.lock()
    defer { lock.unlock() }
    return handle(line)
  }
}

/// Serve the JSONL protocol over a user-only Unix domain socket. Connections are handled
/// sequentially to keep the existing single-threaded EventKit semantics.
func runSocketServer(path: String, handle: @escaping (String) -> String) throws {
  let pathBytes = Array(path.utf8)
  guard path.hasPrefix("/"), pathBytes.count < 104 else { throw HelperSocketError.invalidPath(path) }
  let directory = (path as NSString).deletingLastPathComponent
  try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])

  var existing = stat()
  if lstat(path, &existing) == 0 {
    // Never delete a regular file or directory: only a stale socket from a previous helper.
    guard (existing.st_mode & S_IFMT) == S_IFSOCK else { throw HelperSocketError.invalidPath(path) }
    unlink(path)
  }

  let descriptor = socket(AF_UNIX, SOCK_STREAM, 0)
  guard descriptor >= 0 else { throw HelperSocketError.system("socket", errno) }
  var address = sockaddr_un()
  address.sun_family = sa_family_t(AF_UNIX)
  address.sun_len = UInt8(socketLength(pathBytes))
  withUnsafeMutableBytes(of: &address.sun_path) { raw in
    raw.copyBytes(from: pathBytes)
  }
  let bindResult = withSockaddr(&address) { bind(descriptor, $0, $1) }
  guard bindResult == 0 else {
    let code = errno
    close(descriptor)
    throw HelperSocketError.system("bind", code)
  }
  guard listen(descriptor, 8) == 0 else {
    let code = errno
    close(descriptor)
    unlink(path)
    throw HelperSocketError.system("listen", code)
  }
  chmod(path, 0o600)

  let pidPath = (directory as NSString).appendingPathComponent("helper.pid")
  try "\(getpid())\n".write(toFile: pidPath, atomically: true, encoding: .utf8)
  chmod(pidPath, 0o600)
  appendHelperLog(directory: directory, message: "listening on \(path) (pid \(getpid()))\n")

  defer {
    close(descriptor)
    unlink(path)
    unlink(pidPath)
  }

  signal(SIGPIPE, SIG_IGN)
  let handler = SerializedHandler(handle)
  while true {
    let client = accept(descriptor, nil, nil)
    if client < 0 {
      if errno == EINTR { continue }
      throw HelperSocketError.system("accept", errno)
    }
    Thread.detachNewThread {
      serve(client, handler: handler)
      close(client)
    }
  }
}
