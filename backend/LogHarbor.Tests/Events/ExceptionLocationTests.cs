using LogHarbor.Core.Events;

namespace LogHarbor.Tests.Events;

public sealed class ExceptionLocationTests
{
    [Fact]
    public void DotNetTrace_ReturnsFileAndLine()
    {
        var text = "System.NullReferenceException: boom\n" +
                   "   at OrderService.Ship() in C:\\src\\Services\\OrderService.cs:line 42\n" +
                   "   at OrderPipeline.Run() in C:\\src\\OrderPipeline.cs:line 7";
        Assert.Equal("C:\\src\\Services\\OrderService.cs:42", ExceptionLocation.FromText(text));
    }

    [Fact]
    public void PhpTrace_ReturnsFileAndLine()
    {
        var text = "ErrorException: Undefined variable $foo in /var/www/resources/views/search/index.blade.php:38\n" +
                   "Stack trace:\n#0 /var/www/vendor/laravel/framework/src/Handler.php(255): handleError()";
        Assert.Equal("/var/www/resources/views/search/index.blade.php:38", ExceptionLocation.FromText(text));
    }

    [Fact]
    public void PythonTrace_ReturnsFileAndLine()
    {
        var text = "Traceback (most recent call last):\n" +
                   "  File \"/app/services/orders.py\", line 12, in ship\n" +
                   "ValueError: bad order";
        Assert.Equal("/app/services/orders.py:12", ExceptionLocation.FromText(text));
    }

    [Fact]
    public void NodeTrace_ReturnsFileAndLine()
    {
        var text = "TypeError: Cannot read properties of undefined\n" +
                   "    at ship (/app/src/orders.js:10:15)\n" +
                   "    at run (/app/src/index.js:3:1)";
        Assert.Equal("/app/src/orders.js:10", ExceptionLocation.FromText(text));
    }

    [Fact]
    public void NoFileReference_ReturnsNull()
    {
        Assert.Null(ExceptionLocation.FromText("System.Net.SocketException: boom\n   at Api.Dial()"));
        Assert.Null(ExceptionLocation.FromText("CustomFailure"));
    }
}
