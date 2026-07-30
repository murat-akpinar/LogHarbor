using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using LogHarbor.Core.Auth;
using LogHarbor.Core.Storage;

namespace LogHarbor.Tests.Api;

/// <summary>
/// What a refused directory sign-in writes to the server log. The username on that line is
/// whatever the caller sent, so it is attacker-supplied text on its way into a log file.
/// </summary>
public sealed class LdapLoginLoggingTests : IAsyncLifetime
{
    private readonly LogHarborApiFactory _factory = new();
    private readonly CapturingLoggerProvider _logs = new();
    private HttpClient _client = null!;

    public async Task InitializeAsync()
    {
        _client = _factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
        _factory.Services.GetRequiredService<ILoggerFactory>().AddProvider(_logs);

        await _factory.Services.GetRequiredService<ISettingsStore>().SaveLdapSettingsAsync(new LdapSettings
        {
            Enabled = true,
            // nothing listens here; every attempt fails, which is the path that logs
            Host = "127.0.0.1",
            Port = 1,
            Security = LdapSecurity.None,
            BaseDn = "dc=test,dc=local",
            UserDnPattern = "uid={0},ou=users,dc=test,dc=local",
        });
        _factory.Services.GetRequiredService<LogHarbor.Api.Auth.AuthService>().Invalidate();
    }

    public Task DisposeAsync()
    {
        _factory.Dispose();
        return Task.CompletedTask;
    }

    private Task AttemptAsync(string username) =>
        _client.PostAsJsonAsync("/api/auth/login",
            new { username, password = "whatever", method = "ldap" });

    // a newline produced a convincing second entry: "refused for kotu" then "fail: ..." below it
    [Fact]
    public async Task NewlineInTheUsername_CannotForgeALogLine()
    {
        await AttemptAsync("kotu\nfail: forged entry");

        var line = Assert.Single(_logs.Messages, message => message.Contains("LDAP sign-in refused"));
        Assert.DoesNotContain('\n', line);
        Assert.DoesNotContain("fail: forged entry\n", line);
    }

    [Fact]
    public async Task OverlongUsername_IsTruncatedInTheLog()
    {
        await AttemptAsync(new string('a', 500));

        var line = Assert.Single(_logs.Messages, message => message.Contains("LDAP sign-in refused"));
        Assert.True(line.Length < 200, $"log line was {line.Length} characters");
    }

    private sealed class CapturingLoggerProvider : ILoggerProvider
    {
        public List<string> Messages { get; } = [];

        public ILogger CreateLogger(string categoryName) => new Capturing(Messages);

        public void Dispose() { }

        private sealed class Capturing(List<string> messages) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

            public bool IsEnabled(LogLevel logLevel) => true;

            public void Log<TState>(
                LogLevel logLevel, EventId eventId, TState state, Exception? exception,
                Func<TState, Exception?, string> formatter)
            {
                lock (messages)
                {
                    messages.Add(formatter(state, exception));
                }
            }
        }
    }
}
