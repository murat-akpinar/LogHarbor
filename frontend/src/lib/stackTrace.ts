/**
 * Reads a stack trace instead of printing it.
 *
 * The exception column already holds the whole trace; what an operator does with it today is
 * scan sixty lines by eye for the one that belongs to their own code. That line is findable
 * mechanically: every runtime writes its frames in a fixed shape, and every ecosystem puts its
 * dependencies in a directory whose name says so.
 *
 * No configuration. Atlas feeds its app/vendor split from a per-application namespace field;
 * path markers answer the same question without a form nobody fills in. Where they cannot
 * (a frame with no file at all), the frame is called internal rather than guessed at.
 *
 * Parsing is lossless on purpose — every input line comes back as a frame, as part of the
 * header, or as `text`. A reader must never wonder whether the viewer dropped something.
 */

export type FrameKind = 'app' | 'vendor' | 'internal'

export type Runtime = 'dotnet' | 'node' | 'python' | 'php' | 'java' | 'unknown'

export interface StackFrame {
  /** The line exactly as it arrived, so the viewer can always show the truth. */
  raw: string
  /** Method or function, when the runtime names one. */
  fn: string | null
  file: string | null
  line: number | null
  kind: FrameKind
  /** Extra lines that belong to this frame (Python prints the source line under it). */
  detail: string[]
}

export interface ParsedStack {
  runtime: Runtime
  /** The lines before the first frame: "Type: message", "Traceback (most recent call last):". */
  header: string[]
  frames: StackFrame[]
  /** Lines after the frames that are not frames themselves ("Caused by:", "... 12 more"). */
  trailer: string[]
  counts: { total: number; app: number; vendor: number; internal: number }
  /** Index into `frames` of the first frame in the reader's own code, or null. */
  culpritIndex: number | null
}

/**
 * Where an ecosystem keeps code its author did not write. Substring matches on the file path,
 * which is what makes this work without being told the application's own namespace.
 */
const VENDOR_PATH_MARKERS = [
  '/vendor/',
  '\\vendor\\',
  'node_modules',
  'site-packages',
  'dist-packages',
  '.nuget',
  '/.m2/',
  '/gradle/',
  '/caches/modules-2/',
  '/pub/hosted/',
  '/go/pkg/mod/',
  '/bundle/gems/',
  '/gems/',
]

/** Frames a runtime writes about itself, which have no file to place them by. */
const INTERNAL_MARKERS = [
  'node:internal',
  '[native code]',
  '<anonymous>',
  '<frozen importlib',
  'Native Method',
  'Unknown Source',
  '{main}',
  '--- End of stack trace',
  '--- End of inner exception',
]

/** Namespaces that are somebody else's code even where the trace carries no path. */
const VENDOR_NAMESPACES = [
  'System.',
  'Microsoft.',
  'Newtonsoft.',
  'java.',
  'javax.',
  'jakarta.',
  'sun.',
  'jdk.',
  'org.springframework.',
  'org.hibernate.',
  'org.apache.',
  'Illuminate\\',
  'Symfony\\',
  'Doctrine\\',
  'django/',
  'flask/',
  'rails/',
]

function classify(file: string | null, fn: string | null, raw: string): FrameKind {
  if (INTERNAL_MARKERS.some((marker) => raw.includes(marker))) return 'internal'
  if (file !== null) {
    const path = file.toLowerCase()
    return VENDOR_PATH_MARKERS.some((marker) => path.includes(marker)) ? 'vendor' : 'app'
  }
  // no file: the frame can still name itself out of a package that is plainly not ours
  if (fn !== null && VENDOR_NAMESPACES.some((prefix) => fn.startsWith(prefix))) return 'vendor'
  return 'internal'
}

function frame(raw: string, fn: string | null, file: string | null, line: number | null): StackFrame {
  return { raw, fn, file, line, kind: classify(file, fn, raw), detail: [] }
}

/** One runtime's frame shape. Returns null for a line that is not a frame of that runtime. */
type FrameReader = (line: string) => StackFrame | null

// "at Ns.Type.Method(Int32 id) in C:\src\File.cs:line 42", and the same without the file
const DOTNET_WITH_FILE = /^\s*at (.+?) in (.+?):line (\d+)\s*$/
const DOTNET_BARE = /^\s*at ([\w.<>+`]+(?:\[.*?\])?\(.*?\))\s*$/

const readDotNet: FrameReader = (line) => {
  const withFile = DOTNET_WITH_FILE.exec(line)
  if (withFile) return frame(line, withFile[1], withFile[2], Number(withFile[3]))
  const bare = DOTNET_BARE.exec(line)
  return bare ? frame(line, bare[1], null, null) : null
}

// "at fn (/app/src/x.js:10:15)", "at /app/x.js:10:15", "at async Object.handler (…)"
const NODE_NAMED = /^\s*at (?:async )?(.+?) \((.+?):(\d+):(\d+)\)\s*$/
const NODE_BARE = /^\s*at (?:async )?(.+?):(\d+):(\d+)\s*$/

const readNode: FrameReader = (line) => {
  const named = NODE_NAMED.exec(line)
  if (named) return frame(line, named[1], named[2], Number(named[3]))
  const bare = NODE_BARE.exec(line)
  return bare ? frame(line, null, bare[1], Number(bare[2])) : null
}

// 'File "/app/orders/views.py", line 42, in ship'
const PYTHON_FRAME = /^\s*File "(.+?)", line (\d+)(?:, in (.+))?\s*$/

const readPython: FrameReader = (line) => {
  const match = PYTHON_FRAME.exec(line)
  return match ? frame(line, match[3] ?? null, match[1], Number(match[2])) : null
}

// "#0 /app/app/Http/Controllers/OrderController.php(38): Class->method()" and "#7 {main}"
const PHP_FRAME = /^#\d+ (.+?)\((\d+)\): (.+?)\s*$/
const PHP_MAIN = /^#\d+ \{main\}\s*$/

const readPhp: FrameReader = (line) => {
  const match = PHP_FRAME.exec(line)
  if (match) return frame(line, match[3], match[1], Number(match[2]))
  return PHP_MAIN.test(line) ? frame(line, null, null, null) : null
}

// "at com.acme.OrderService.ship(OrderService.java:42)", "at x.y(Native Method)"
const JAVA_FRAME = /^\s*at ([\w$.<>/]+)\((.+?):(\d+)\)\s*$/
const JAVA_NO_SOURCE = /^\s*at ([\w$.<>/]+)\((?:Native Method|Unknown Source)\)\s*$/

const readJava: FrameReader = (line) => {
  const match = JAVA_FRAME.exec(line)
  if (match) {
    // the java frame carries a bare file name; the package in the method is what places it
    const inner = frame(line, match[1], match[2], Number(match[3]))
    return { ...inner, kind: classify(null, match[1], line) === 'vendor' ? 'vendor' : inner.kind }
  }
  const noSource = JAVA_NO_SOURCE.exec(line)
  return noSource ? frame(line, noSource[1], null, null) : null
}

/** Java's "at x.y(File.java:12)" also parses as .NET's bare form, so order breaks ties. */
const READERS: { runtime: Exclude<Runtime, 'unknown'>; read: FrameReader }[] = [
  { runtime: 'python', read: readPython },
  { runtime: 'php', read: readPhp },
  { runtime: 'java', read: readJava },
  { runtime: 'dotnet', read: readDotNet },
  { runtime: 'node', read: readNode },
]

/**
 * The trace, read.
 *
 * The runtime is decided by counting: whichever reader recognises the most lines is the one
 * that wrote it. Sniffing the first line instead would miss a .NET trace whose first frame has
 * no file, and a wrong guess reads worse than no parsing at all.
 */
export function parseStackTrace(text: string): ParsedStack {
  const lines = text.replaceAll('\r\n', '\n').split('\n')

  let best: { runtime: Runtime; read: FrameReader; hits: number } = {
    runtime: 'unknown',
    read: () => null,
    hits: 0,
  }
  for (const { runtime, read } of READERS) {
    const hits = lines.reduce((count, line) => count + (read(line) === null ? 0 : 1), 0)
    if (hits > best.hits) best = { runtime, read, hits }
  }

  const header: string[] = []
  const frames: StackFrame[] = []
  const trailer: string[] = []

  for (const line of lines) {
    const parsed = best.read(line)
    if (parsed !== null) {
      frames.push(parsed)
      continue
    }
    if (frames.length === 0) {
      header.push(line)
    } else if (line.trim().length === 0) {
      // a blank line between frames is not information; one after them is not either
      continue
    } else if (best.runtime === 'python' && line.startsWith('    ')) {
      // Python prints the offending source line under its frame — it belongs to that frame
      frames[frames.length - 1].detail.push(line.trim())
    } else {
      trailer.push(line)
    }
  }

  // trailing blank lines in the header are noise, not the message
  while (header.length > 0 && header[header.length - 1].trim().length === 0) header.pop()

  const counts = {
    total: frames.length,
    app: frames.filter((item) => item.kind === 'app').length,
    vendor: frames.filter((item) => item.kind === 'vendor').length,
    internal: frames.filter((item) => item.kind === 'internal').length,
  }

  // the frame worth reading first: the topmost one in the reader's own code, and where the
  // trace never enters it, the topmost one that at least names a file
  let culpritIndex: number | null = frames.findIndex((item) => item.kind === 'app')
  if (culpritIndex === -1) culpritIndex = frames.findIndex((item) => item.file !== null)
  if (culpritIndex === -1) culpritIndex = null

  return { runtime: best.runtime, header, frames, trailer, counts, culpritIndex }
}

/** Consecutive frames of the same worth, so a run of vendor frames collapses as one block. */
export interface FrameGroup {
  kind: FrameKind
  frames: { frame: StackFrame; index: number }[]
}

export function groupFrames(frames: StackFrame[]): FrameGroup[] {
  const groups: FrameGroup[] = []
  frames.forEach((item, index) => {
    // internal frames sit inside a vendor run rather than splitting it in two: both are
    // "not your code", and a 40-frame trace should collapse to a handful of blocks
    const kind: FrameKind = item.kind === 'internal' ? 'vendor' : item.kind
    const last = groups[groups.length - 1]
    if (last !== undefined && last.kind === kind) {
      last.frames.push({ frame: item, index })
    } else {
      groups.push({ kind, frames: [{ frame: item, index }] })
    }
  })
  return groups
}

/** The tail of a path, which is what identifies a frame at a glance: "…/Orders/OrderService.cs". */
export function shortPath(file: string, segments = 2): string {
  const parts = file.split(/[/\\]/).filter((part) => part.length > 0)
  return parts.length <= segments ? file : `…/${parts.slice(-segments).join('/')}`
}
