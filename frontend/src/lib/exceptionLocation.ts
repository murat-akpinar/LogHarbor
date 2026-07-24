// Stack-trace formats differ per runtime, so the first matching pattern wins.
// Mirrors the backend's ExceptionLocation (used for the Exceptions page's Source column).
const PATTERNS: RegExp[] = [
  / in (.+?):line (\d+)/, // .NET: "at Ns.Type.Method() in C:\src\File.cs:line 42"
  /File "(.+?)", line (\d+)/, // Python
  /\((.+?):(\d+):\d+\)/, // Node: "at fn (/app/src/x.js:10:15)"
  /(\S+\.\w{1,10})(?::(\d+)|\((\d+)\))/, // PHP and generic "path/file.ext:38" / "file.php(38)"
]

/** "path:line" from an exception text, or null when no frame carries a file. */
export function exceptionLocation(exception: string): string | null {
  for (const pattern of PATTERNS) {
    const match = pattern.exec(exception)
    if (match) {
      const line = match[2] ?? match[3]
      return line ? `${match[1]}:${line}` : null
    }
  }
  return null
}
