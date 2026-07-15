using LogHarbor.Core.Auth;

namespace LogHarbor.Tests.Auth;

public sealed class PasswordHasherTests
{
    [Fact]
    public void Verify_CorrectPassword_ReturnsTrue()
    {
        var hashed = PasswordHasher.Hash("s3cret");

        Assert.True(PasswordHasher.Verify("s3cret", hashed));
    }

    [Fact]
    public void Verify_WrongPassword_ReturnsFalse()
    {
        var hashed = PasswordHasher.Hash("s3cret");

        Assert.False(PasswordHasher.Verify("S3cret", hashed));
        Assert.False(PasswordHasher.Verify("", hashed));
    }

    [Fact]
    public void Hash_SamePasswordTwice_ProducesDifferentSaltsAndHashes()
    {
        var first = PasswordHasher.Hash("s3cret");
        var second = PasswordHasher.Hash("s3cret");

        Assert.NotEqual(first.Salt, second.Salt);
        Assert.NotEqual(first.Hash, second.Hash);
        Assert.True(PasswordHasher.Verify("s3cret", first));
        Assert.True(PasswordHasher.Verify("s3cret", second));
    }

    [Fact]
    public void Hash_DoesNotContainThePlaintext()
    {
        var hashed = PasswordHasher.Hash("s3cret");

        Assert.DoesNotContain("s3cret", Convert.ToBase64String(hashed.Hash));
    }
}
