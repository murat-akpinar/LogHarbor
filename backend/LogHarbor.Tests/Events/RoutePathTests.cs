using LogHarbor.Core.Events;

namespace LogHarbor.Tests.Events;

public sealed class RoutePathTests
{
    [Theory]
    [InlineData("/api/orders/41973", "/api/orders/{id}")]
    [InlineData("/api/carts/60021/items/7", "/api/carts/{id}/items/{id}")]
    [InlineData("/api/invoices/8/pdf", "/api/invoices/{id}/pdf")]
    [InlineData("/users/1", "/users/{id}")]
    [InlineData("/api/orders/41973/", "/api/orders/{id}/")]
    public void NumericSegment_BecomesId(string path, string expected)
    {
        Assert.Equal(expected, RoutePath.Fold(path));
    }

    [Theory]
    [InlineData("/api/reports/3f2504e0-4f89-11d3-9a0c-0305e82c3301", "/api/reports/{id}")]
    [InlineData("/api/sessions/9b2f4c1d8e7a6b5c4d3e2f1a0b9c8d7e", "/api/sessions/{id}")]
    public void UuidSegment_BecomesId(string path, string expected)
    {
        Assert.Equal(expected, RoutePath.Fold(path));
    }

    // The install that already logs templates is the one that reads well today; folding must be
    // invisible to it, or the guard breaks the case it was meant to protect.
    [Theory]
    [InlineData("/api/orders/{id}")]
    [InlineData("/api/carts/{cartId}/items/{itemId}")]
    [InlineData("/api/orders")]
    [InlineData("/health")]
    [InlineData("/api/v2/products")]
    [InlineData("/")]
    [InlineData("")]
    [InlineData("healthz")]
    public void PathWithoutAnId_IsUnchanged(string path)
    {
        Assert.Same(path, RoutePath.Fold(path));
    }

    // Short hex is a word far more often than an id: /api/cafe or /api/dad would fold away a
    // real route name. Only a run long enough to be a uuid or a hash counts.
    [Theory]
    [InlineData("/api/beef/list")]
    [InlineData("/api/abc")]
    [InlineData("/api/deadbeef")]
    public void ShortHexSegment_IsNotAnId(string path)
    {
        Assert.Same(path, RoutePath.Fold(path));
    }

    [Fact]
    public void DashesAlone_AreNotAnId()
    {
        Assert.Same("/api/--------------------", RoutePath.Fold("/api/--------------------"));
    }

    // Documented tradeoff: a segment that is only digits is taken for an id, and a date or a
    // version number in a path reads the same way. Grouping a year with its siblings is a far
    // smaller error than splitting one route into a row per order.
    [Fact]
    public void NumericSegmentThatIsNotAnId_FoldsAnyway()
    {
        Assert.Equal("/reports/{id}/summary", RoutePath.Fold("/reports/2026/summary"));
    }
}
