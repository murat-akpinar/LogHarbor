import { expect, it } from 'vitest'
import { groupFrames, parseStackTrace, shortPath } from './stackTrace'

// Real shapes, not invented ones: the whole value of this parser is that it recognises what
// the runtimes actually print, and a trace written to suit the regex proves nothing.

const DOTNET = `System.NullReferenceException: Object reference not set to an instance of an object.
   at LogHarbor.Api.Orders.OrderService.Ship(Int32 orderId) in /src/Api/Orders/OrderService.cs:line 88
   at Microsoft.AspNetCore.Mvc.Infrastructure.ActionMethodExecutor.SyncActionResultExecutor.Execute(IActionResultTypeMapper mapper, ObjectMethodExecutor executor, Object controller, Object[] arguments)
   at Microsoft.AspNetCore.Mvc.Infrastructure.ControllerActionInvoker.InvokeActionMethodAsync()
   --- End of stack trace from previous location ---
   at LogHarbor.Api.Middleware.ErrorHandler.Invoke(HttpContext context) in /src/Api/Middleware/ErrorHandler.cs:line 17`

const NODE = `TypeError: Cannot read properties of undefined (reading 'id')
    at OrderService.ship (/app/src/services/order.js:42:19)
    at /app/node_modules/express/lib/router/route.js:149:13
    at Layer.handle [as handle_request] (/app/node_modules/express/lib/router/layer.js:95:5)
    at processTicksAndRejections (node:internal/process/task_queues:95:5)`

const PYTHON = `Traceback (most recent call last):
  File "/app/orders/views.py", line 42, in ship
    order.save()
  File "/usr/local/lib/python3.11/site-packages/django/db/models/base.py", line 812, in save
    self.save_base(using=using)
ValueError: order is not payable`

const PHP = `Illuminate\\Database\\QueryException: SQLSTATE[42S02]: Base table or view not found
#0 /app/vendor/laravel/framework/src/Illuminate/Database/Connection.php(760): Illuminate\\Database\\Connection->runQueryCallback()
#1 /app/app/Http/Controllers/OrderController.php(38): Illuminate\\Database\\Connection->select()
#2 /app/vendor/laravel/framework/src/Illuminate/Routing/Controller.php(54): App\\Http\\Controllers\\OrderController->show()
#3 {main}`

const JAVA = `java.lang.NullPointerException: Cannot invoke "com.acme.Order.getId()" because "order" is null
\tat com.acme.orders.OrderService.ship(OrderService.java:42)
\tat org.springframework.web.servlet.mvc.method.AnnotationMethodHandlerAdapter.handle(AnnotationMethodHandlerAdapter.java:909)
\tat java.base/java.lang.Thread.run(Thread.java:840)
Caused by: java.sql.SQLException: connection closed
\t... 12 more`

it('reads a .NET trace and finds the line that belongs to the application', () => {
  const stack = parseStackTrace(DOTNET)

  expect(stack.runtime).toBe('dotnet')
  expect(stack.header).toEqual([
    'System.NullReferenceException: Object reference not set to an instance of an object.',
  ])
  expect(stack.counts.app).toBe(2)
  // the two Mvc frames carry no file at all and name a Microsoft package
  expect(stack.counts.vendor).toBe(2)

  const culprit = stack.frames[stack.culpritIndex!]
  expect(culprit.file).toBe('/src/Api/Orders/OrderService.cs')
  expect(culprit.line).toBe(88)
  expect(culprit.fn).toContain('OrderService.Ship')
})

it('reads a Node trace and calls node_modules and node internals somebody else', () => {
  const stack = parseStackTrace(NODE)

  expect(stack.runtime).toBe('node')
  expect(stack.counts.total).toBe(4)
  expect(stack.frames[0].kind).toBe('app')
  expect(stack.frames[0].file).toBe('/app/src/services/order.js')
  expect(stack.frames[0].line).toBe(42)
  expect(stack.frames[1].kind).toBe('vendor')
  expect(stack.frames[2].kind).toBe('vendor')
  expect(stack.frames[3].kind).toBe('internal')
  expect(stack.culpritIndex).toBe(0)
})

it('reads a Python traceback, keeps its source lines with their frames', () => {
  const stack = parseStackTrace(PYTHON)

  expect(stack.runtime).toBe('python')
  expect(stack.header).toEqual(['Traceback (most recent call last):'])
  expect(stack.frames).toHaveLength(2)
  expect(stack.frames[0].kind).toBe('app')
  expect(stack.frames[0].fn).toBe('ship')
  expect(stack.frames[0].detail).toEqual(['order.save()'])
  // site-packages is Django's, not the application's
  expect(stack.frames[1].kind).toBe('vendor')
  // the message comes after the frames in Python, and it is not thrown away
  expect(stack.trailer).toEqual(['ValueError: order is not payable'])
})

it('reads a Laravel trace and picks the controller out of the framework', () => {
  const stack = parseStackTrace(PHP)

  expect(stack.runtime).toBe('php')
  expect(stack.counts.total).toBe(4)
  expect(stack.frames.map((item) => item.kind)).toEqual(['vendor', 'app', 'vendor', 'internal'])

  const culprit = stack.frames[stack.culpritIndex!]
  expect(culprit.file).toBe('/app/app/Http/Controllers/OrderController.php')
  expect(culprit.line).toBe(38)
})

it('reads a Java trace and places frames by their package when there is no path', () => {
  const stack = parseStackTrace(JAVA)

  expect(stack.runtime).toBe('java')
  expect(stack.frames[0].kind).toBe('app')
  expect(stack.frames[0].file).toBe('OrderService.java')
  expect(stack.frames[0].line).toBe(42)
  expect(stack.frames[1].kind).toBe('vendor')
  expect(stack.frames[2].kind).toBe('vendor')
  // "Caused by:" and "... 12 more" are not frames and must survive as text
  expect(stack.trailer).toEqual([
    'Caused by: java.sql.SQLException: connection closed',
    '\t... 12 more',
  ])
})

// the one property that makes the viewer trustworthy: it can hide lines, never lose them
it.each([
  ['dotnet', DOTNET],
  ['node', NODE],
  ['python', PYTHON],
  ['php', PHP],
  ['java', JAVA],
])('accounts for every line of the %s trace', (_runtime, text) => {
  const stack = parseStackTrace(text)

  const seen = [
    ...stack.header,
    ...stack.frames.flatMap((item) => [item.raw, ...item.detail.map((line) => `    ${line}`)]),
    ...stack.trailer,
  ].length
  expect(seen).toBe(text.split('\n').length)
})

it('leaves a trace it does not recognise whole rather than half-parsing it', () => {
  const stack = parseStackTrace('something went wrong\nand then some more of it')

  expect(stack.runtime).toBe('unknown')
  expect(stack.frames).toHaveLength(0)
  expect(stack.header).toEqual(['something went wrong', 'and then some more of it'])
  expect(stack.culpritIndex).toBeNull()
})

it('collapses a run of frames nobody wrote into one block', () => {
  const groups = groupFrames(parseStackTrace(NODE).frames)

  // app, then the three that are not: two vendor and one internal, as a single run
  expect(groups).toHaveLength(2)
  expect(groups[0].kind).toBe('app')
  expect(groups[1].kind).toBe('vendor')
  expect(groups[1].frames).toHaveLength(3)
  // the index into the original list survives, so a group can still say where it sat
  expect(groups[1].frames[0].index).toBe(1)
})

it('shortens a path to what identifies it', () => {
  expect(shortPath('/src/Api/Orders/OrderService.cs')).toBe('…/Orders/OrderService.cs')
  expect(shortPath('C:\\src\\App\\Thing.cs')).toBe('…/App/Thing.cs')
  expect(shortPath('order.js')).toBe('order.js')
})
