namespace LogHarbor.Core.Storage;

/// <summary>
/// Property names whose values this server refuses to keep (docs/redaction.md).
///
/// Empty is the shipped state and means the feature does nothing: a log server that silently
/// dropped fields nobody asked it to drop would be worse than one that keeps too much, because
/// the loss is invisible and permanent. Seq does not redact by default either.
/// </summary>
public sealed record RedactionSettings
{
    /// <summary>Name fragments, matched case-insensitively against every property name in the
    /// event, nested ones included. "token" covers AccessToken and X-Csrf-Token.</summary>
    public IReadOnlyList<string> Properties { get; init; } = [];

    public bool Enabled => Properties.Count > 0;
}
