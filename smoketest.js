#! node
const MemJS = require(".");
const assert = require("assert");
const client = MemJS.Client.create();

function assertBufferEqual(buf1, buf2, msg) {
  assert.strictEqual(buf1.toString(), buf2.toString(), msg);
}

async function body() {
  await client.set("foo", "1");

  let { value, cas } = await client.get("foo");
  assert.strictEqual(value.toString(), "1");
  assert.ok(cas, "must return a CAS token");

  const successWithBadCas = await client.set("foo", "should not set", {
    cas: Buffer.from("wrong"),
  });
  assert.strictEqual(false, successWithBadCas, "should not set with a bad CAS");

  const v2 = await client.get("foo");
  assert.strictEqual(v2.value.toString(), "1", "did not get set");
  assertBufferEqual(cas, v2.cas, "cas tokens are equal still");

  assert.ok(
    await client.set("foo", "1", { cas }),
    "set with original cas token to identical value"
  );
  let { cas: cas3 } = await client.get("foo");
  assert.notStrictEqual(
    cas.toString(),
    cas3.toString(),
    "has new CAS after identical set"
  );
}

async function main() {
  try {
    await body();
    console.log("smoketest ok");
  } catch (error) {
    console.error("fatal", error);
    process.exit(1);
  } finally {
    client.quit();
  }
}

main();
