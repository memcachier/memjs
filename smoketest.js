#! node
const MemJS = require(".");
const assert = require("assert");
const client = MemJS.Client.create();
// We cannot fake Memcached server close for more than 1 second.
// So we reduce the retries to fake the server down.
const client2 = MemJS.Client.create(undefined, { retries: 1 });

function assertBufferEqual(buf1, buf2, msg) {
  assert.strictEqual(buf1.toString(), buf2.toString(), msg);
}

async function testCloseConnection() {
  await client2.set("foo2", "1");
  let { value } = await client2.get("foo2");
  assert.strictEqual(value.toString(), "1");

  client2.close();
  // Some time to handle socket close event.
  await new Promise((resolve) => setTimeout(resolve, 10));

  const v3 = await client2.get("foo2");
  assert.strictEqual(v3.value.toString(), value.toString(), "did not get set");
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

  await testCloseConnection();
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
    client2.quit();
  }
}

main();
