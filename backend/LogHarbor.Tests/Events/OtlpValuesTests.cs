using Google.Protobuf;
using OpenTelemetry.Proto.Common.V1;
using LogHarbor.Core.Events.Otlp;

namespace LogHarbor.Tests.Events;

public sealed class OtlpValuesTests
{
    private static KeyValue Kv(string key, AnyValue value) => new() { Key = key, Value = value };

    [Fact]
    public void Scalars_MapToJsonEquivalents()
    {
        Assert.Equal("\"x\"", OtlpValues.ToJsonNode(new AnyValue { StringValue = "x" })!.ToJsonString());
        Assert.Equal("true", OtlpValues.ToJsonNode(new AnyValue { BoolValue = true })!.ToJsonString());
        Assert.Equal("42", OtlpValues.ToJsonNode(new AnyValue { IntValue = 42 })!.ToJsonString());
        Assert.Equal("1.5", OtlpValues.ToJsonNode(new AnyValue { DoubleValue = 1.5 })!.ToJsonString());
    }

    [Fact]
    public void Bytes_BecomeBase64Strings()
    {
        var value = new AnyValue { BytesValue = ByteString.CopyFrom([1, 2, 3]) };
        Assert.Equal("\"AQID\"", OtlpValues.ToJsonNode(value)!.ToJsonString());
    }

    [Fact]
    public void EmptyAnyValue_IsNull()
    {
        Assert.Null(OtlpValues.ToJsonNode(new AnyValue()));
        Assert.Null(OtlpValues.ToJsonNode(null));
    }

    [Fact]
    public void ArraysAndKvlists_NestRecursively()
    {
        var array = new AnyValue { ArrayValue = new ArrayValue() };
        array.ArrayValue.Values.Add(new AnyValue { IntValue = 1 });
        array.ArrayValue.Values.Add(new AnyValue { StringValue = "two" });

        var kvlist = new AnyValue { KvlistValue = new KeyValueList() };
        kvlist.KvlistValue.Values.Add(Kv("inner", array));

        Assert.Equal("""{"inner":[1,"two"]}""", OtlpValues.ToJsonNode(kvlist)!.ToJsonString());
    }

    [Fact]
    public void ToJsonObject_LastValueWins_OnDuplicateKeys()
    {
        var result = OtlpValues.ToJsonObject(
            [Kv("k", new AnyValue { IntValue = 1 }), Kv("k", new AnyValue { IntValue = 2 })]);

        Assert.Equal("""{"k":2}""", result.ToJsonString());
    }
}
