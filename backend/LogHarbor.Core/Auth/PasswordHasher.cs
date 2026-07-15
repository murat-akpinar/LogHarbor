using System.Security.Cryptography;
using System.Text;

namespace LogHarbor.Core.Auth;

/// <summary>PBKDF2-SHA256 password hashing (rules.md SECURITY). Verification is constant time.</summary>
public static class PasswordHasher
{
    private const int SaltBytes = 16;
    private const int HashBytes = 32;
    private const int Iterations = 100_000;

    public sealed record HashedPassword(byte[] Salt, byte[] Hash);

    public static HashedPassword Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltBytes);
        return new HashedPassword(salt, Derive(password, salt));
    }

    public static bool Verify(string password, HashedPassword hashed) =>
        CryptographicOperations.FixedTimeEquals(Derive(password, hashed.Salt), hashed.Hash);

    private static byte[] Derive(string password, byte[] salt) =>
        Rfc2898DeriveBytes.Pbkdf2(
            Encoding.UTF8.GetBytes(password), salt, Iterations, HashAlgorithmName.SHA256, HashBytes);
}
