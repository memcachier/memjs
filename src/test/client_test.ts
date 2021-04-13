import tap from "tap";
const test = tap.test;

import MemJS = require("../memjs/memjs");
import constants = require("../memjs/constants");
import { noopSerializer } from "../memjs/noop-serializer";
import { Header } from "../memjs/header";
import type { GivenClientOptions } from "../memjs/memjs";
import * as Utils from "../memjs/utils";
import { MaybeBuffer } from "../memjs/utils";

// I could not figure out a better way to extract this from the typedefs
type TapTestType = typeof tap["Test"]["prototype"];

function testAllCallbacksEmpty(t: TapTestType, server: MemJS.Server) {
  t.deepEqual(Object.keys(server.responseCallbacks).length, 0);
  t.deepEqual(Object.keys(server.errorCallbacks).length, 0);

  t.deepEqual(server.requestTimeouts, []);
}

function makeClient(
  dummyServer: MemJS.Server | MemJS.Server[],
  options?: GivenClientOptions<MaybeBuffer, any>
) {
  return new MemJS.Client(
    Array.isArray(dummyServer) ? dummyServer : [dummyServer],
    options || { serializer: noopSerializer }
  );
}

function parseMessage(requestBuf: Buffer) {
  const message = Utils.parseMessage(requestBuf);
  if (!message) {
    throw new Error("Expected message to parse successfully, but got false");
  }
  return message;
}

function makeDummyServer(name: string) {
  /* NOTE(blackmad): awful hack - MemJS natively speaks Buffers, but they are annoying
	   to test, so we shim it in some ugly ways to return strings which are easier to work
		 with. We should fix this at some point.
	  */
  return new MemJS.Server(name) as MemJS.Server & {
    respond: (m: {
      extras?: string | Buffer;
      key?: string | Buffer;
      val?: string | Buffer;
      header: Partial<Header>;
    }) => void;
  };
}

async function mustReject(
  t: TapTestType,
  promise: Promise<unknown>,
  matcher: (error: Error) => any
) {
  let threwError: Error | undefined = undefined;
  try {
    await promise;
  } catch (error) {
    threwError = error;
  }

  t.assert(threwError, "Expected promise to be rejected");
  if (threwError) {
    return matcher(threwError);
  }
}

test("GetSuccessful", async function (t) {
  let n = 0;
  const dummyServer = makeDummyServer("dummyServer");
  const casToken = Buffer.from("cas data");
  dummyServer.write = function (requestBuf) {
    const request = parseMessage(requestBuf);
    t.equal("hello", request.key.toString());
    n += 1;
    dummyServer.respond({
      header: { status: 0, opaque: request.header.opaque, cas: casToken },
      val: "world",
      extras: "flagshere",
    });
  };

  const client = makeClient([dummyServer]);
  const val = await client.get("hello");

  if (!val) {
    t.ok(val, "must return value");
    return;
  }
  t.equal("world", val.value);
  t.equal("flagshere", val.extras);
  t.equal(casToken, val.cas);
  t.equal(1, n, "Ensure get is called");
});

test("GetNotFound", async function (t) {
  let n = 0;
  const dummyServer = makeDummyServer("dummyServer");
  dummyServer.write = function (requestBuf) {
    const request = parseMessage(requestBuf);
    t.equal("hello", request.key.toString());
    n += 1;
    dummyServer.respond({
      header: { status: 1, opaque: request.header.opaque },
    });
  };

  const client = makeClient([dummyServer]);
  const val = await client.get("hello");
  t.equal(null, val);
  t.equal(1, n, "Ensure get is called");
});

test("GetSerializer", async function (t) {
  let n = 0;
  let dn = 0;
  const dummyServer = makeDummyServer("dummyServer");
  const casToken = Buffer.from("cas shmoken");
  dummyServer.write = function (requestBuf) {
    const request = parseMessage(requestBuf);
    t.equal("hello", request.key.toString());
    n += 1;
    dummyServer.respond({
      header: { status: 0, opaque: request.header.opaque, cas: casToken },
      val: "world",
      extras: "flagshere",
    });
  };

  const client = makeClient([dummyServer], {
    serializer: {
      serialize: function (opcode, value, extras) {
        return { value: value, extras: extras };
      },
      deserialize: function (opcode, value, extras) {
        dn += 1;
        return { value: "deserialized", extras: extras };
      },
    },
  });
  const value = await client.get("hello");
  if (!value) {
    t.ok(value, "must return value");
    return;
  }
  t.equal("deserialized", value.value);
  t.equal("flagshere", value.extras);
  t.equal(casToken, value.cas);
  t.equal(1, n, "Ensure get is called");
  t.equal(1, dn, "Ensure deserialization is called once");
});

test("GetMultiSuccessful_SingleBackend", async function (t) {
  let n = 0;
  const dummyServer = makeDummyServer("dummyServer");
  dummyServer.write = function (requestBuf) {
    const requests = Utils.parseMessages(requestBuf);
    t.equal(requests.length, 4);
    n += 1;

    function checkAndRespond(
      request: Utils.Message,
      key: string,
      value: string
    ) {
      t.equal(key, request.key.toString());
      t.equal(constants.OP_GETKQ, request.header.opcode);

      dummyServer.respond({
        header: {
          status: 0,
          opaque: request.header.opaque,
          opcode: request.header.opcode,
          cas: Buffer.from(`cas ${key}`),
        },
        key: key,
        val: value,
        extras: "flagshere",
      });
    }
    checkAndRespond(requests[0], "hello1", "world1");
    checkAndRespond(requests[1], "hello2", "world2");
    checkAndRespond(requests[2], "hello3", "world3");

    t.equal(constants.OP_NO_OP, requests[3].header.opcode);
    dummyServer.respond({
      header: {
        status: 0,
        opaque: requests[3].header.opaque,
        opcode: requests[3].header.opcode,
      },
    });
  };

  const client = makeClient([dummyServer]);
  const result = await client.getMulti(["hello1", "hello2", "hello3"]);
  t.deepEqual(
    {
      hello1: {
        value: "world1",
        extras: "flagshere",
        cas: Buffer.from("cas hello1"),
      },
      hello2: {
        value: "world2",
        extras: "flagshere",
        cas: Buffer.from("cas hello2"),
      },
      hello3: {
        value: "world3",
        extras: "flagshere",
        cas: Buffer.from("cas hello3"),
      },
    },
    result
  );
  t.equal(1, n, "Ensure getMulti is called");
});

const DummyMultiGetFlags = "flagshere";

function makeDummyMultiGetServerResponder(
  t: TapTestType,
  responseMap: Record<string, string | undefined>,
  serverName?: string
) {
  const server = makeDummyServer(serverName || "dummyServer");
  const responder = function (requestBuf: Buffer) {
    const requests = Utils.parseMessages(requestBuf);
    t.equal(requests.length, Object.keys(responseMap).length + 1);

    function checkAndRespond(
      request: Utils.Message,
      key: string,
      value: string | undefined
    ) {
      t.equal(constants.OP_GETKQ, request.header.opcode);

      if (value !== undefined) {
        server.respond({
          header: {
            status: 0,
            opaque: request.header.opaque,
            opcode: request.header.opcode,
          },
          key: key,
          val: value,
          extras: DummyMultiGetFlags,
        });
      }
    }

    for (const requestIndex in requests) {
      const request = requests[requestIndex];

      if (requestIndex === (requests.length - 1).toString()) {
        t.equal(constants.OP_NO_OP, request.header.opcode);
        server.respond({
          header: {
            status: 0,
            opaque: request.header.opaque,
            opcode: request.header.opcode,
          },
        });
      } else {
        const key = request.key.toString();
        checkAndRespond(request, key, responseMap[key]);
      }
    }
  };
  server.write = responder;
  return server;
}

test("GetMultiSuccessful_MultiBackend", async function (t) {
  // the mappings from key to server were computer by just manually running the default hash on them

  const dummyServer1 = makeDummyMultiGetServerResponder(
    t,
    {
      hello2: "world2",
      hello4: "world4",
    },
    "dummyServer1"
  );
  const dummyServer2 = makeDummyMultiGetServerResponder(
    t,
    {
      hello1: "world1",
      hello3: "world3",
    },
    "dummyServer2"
  );
  const servers = [dummyServer1, dummyServer2];

  const client = makeClient(servers);
  const val = await client.getMulti(["hello1", "hello2", "hello3", "hello4"]);

  const expected: MemJS.GetMultiResult<
    "hello1" | "hello2" | "hello3" | "hello4"
  > = {
    hello1: {
      value: "world1",
      extras: DummyMultiGetFlags,
      cas: undefined,
    },
    hello2: {
      value: "world2",
      extras: DummyMultiGetFlags,
      cas: undefined,
    },
    hello3: {
      value: "world3",
      extras: DummyMultiGetFlags,
      cas: undefined,
    },
    hello4: {
      value: "world4",
      extras: DummyMultiGetFlags,
      cas: undefined,
    },
  };
  t.deepEqual(expected, val);
  testAllCallbacksEmpty(t, dummyServer1);
  testAllCallbacksEmpty(t, dummyServer2);
});

test("GetMultiSuccessful_MissingKeys_MultiBackend", async function (t) {
  // the mappings from key to server were computed by just manually running the default hash on them
  const dummyServer1 = makeDummyMultiGetServerResponder(
    t,
    {
      hello2: undefined,
      hello4: "world4",
    },
    "dummyServer1"
  );
  const dummyServer2 = makeDummyMultiGetServerResponder(
    t,
    {
      hello1: "world1",
      hello3: "world3",
    },
    "dummyServer2"
  );
  const servers = [dummyServer1, dummyServer2];

  const client = makeClient(servers);
  const val = await client.getMulti(["hello1", "hello2", "hello3", "hello4"]);

  const expected: MemJS.GetMultiResult<"hello1" | "hello3" | "hello4"> = {
    hello1: {
      value: "world1",
      extras: DummyMultiGetFlags,
      cas: undefined,
    },
    hello3: {
      value: "world3",
      extras: DummyMultiGetFlags,
      cas: undefined,
    },
    hello4: {
      value: "world4",
      extras: DummyMultiGetFlags,
      cas: undefined,
    },
  };
  t.deepEqual(expected, val);
  testAllCallbacksEmpty(t, dummyServer1);
  testAllCallbacksEmpty(t, dummyServer2);
});

test("GetMultiError_MultiBackend", async function (t) {
  // the mappings from key to server were computed by just manually running the default hash on them
  const dummyServer1 = makeDummyMultiGetServerResponder(
    t,
    {
      hello2: undefined,
      hello4: "world4",
    },
    "dummyServer1"
  );
  const dummyServer2 = makeDummyMultiGetServerResponder(
    t,
    {
      hello1: "world1",
      hello3: "world3",
    },
    "dummyServer2"
  );
  dummyServer2.write = function () {
    dummyServer2.error({
      name: "ErrorName",
      message: "This is an expected error.",
    });
  };
  const servers = [dummyServer1, dummyServer2];

  const client = makeClient(servers);

  await mustReject(
    t,
    client.getMulti(["hello1", "hello2", "hello3", "hello4"]),
    (error) => {
      t.equal("This is an expected error.", error.message);
      testAllCallbacksEmpty(t, dummyServer1);
      testAllCallbacksEmpty(t, dummyServer2);
    }
  );
});

test("GetMultiSuccessfulWithMissingKeys", async function (t) {
  const dummyServer = makeDummyMultiGetServerResponder(t, {
    hello1: "world1",
    hello2: undefined,
    hello3: "world3",
  });

  const client = makeClient([dummyServer], { serializer: noopSerializer });
  const assertor = function (
    err: Error | null,
    val: MemJS.GetMultiResult | null
  ) {
    t.equal(null, err);
  };
  const val = await client.getMulti(["hello1", "hello2", "hello3"]);
  const expected: MemJS.GetMultiResult<"hello1" | "hello3"> = {
    hello1: {
      value: "world1",
      extras: DummyMultiGetFlags,
      cas: undefined,
    },
    hello3: {
      value: "world3",
      extras: DummyMultiGetFlags,
      cas: undefined,
    },
  };
  t.deepEqual(expected, val);
  testAllCallbacksEmpty(t, dummyServer);
});

test("GetMultiError", function (t) {
  const dummyServer = makeDummyServer("dummyServer");
  dummyServer.write = function (requestBuf) {
    const requests = Utils.parseMessages(requestBuf);
    t.equal(requests.length, 4);

    function checkAndRespond(
      request: Utils.Message,
      key: string,
      value: string
    ) {
      t.equal(key, request.key.toString());
      t.equal(constants.OP_GETKQ, request.header.opcode);

      dummyServer.respond({
        header: {
          status: 0,
          opaque: request.header.opaque,
          opcode: request.header.opcode,
        },
        key: key,
        val: value,
        extras: "flagshere",
      });
    }
    checkAndRespond(requests[0], "hello1", "world1");
    dummyServer.error({
      name: "ErrorName",
      message: "This is an expected error.",
    });
  };

  const client = makeClient([dummyServer]);
  const assertor = function (err: Error | null) {
    t.notEqual(null, err);
    testAllCallbacksEmpty(t, dummyServer);
    t.equal("This is an expected error.", err?.message);
  };

  return mustReject(
    t,
    client.getMulti(["hello1", "hello2", "hello3"]),
    assertor
  );
});

test("SetSuccessful", async function (t) {
  const casToken = Buffer.from("cas toke");
  let n = 0;
  const dummyServer = makeDummyServer("dummyServer");
  dummyServer.write = function (requestBuf) {
    const request = parseMessage(requestBuf);
    t.equal("hello", request.key.toString());
    t.equal("world", request.val.toString());
    t.equal("cas toke", request.header.cas && request.header.cas.toString());
    n += 1;
    dummyServer.respond({
      header: { status: 0, opaque: request.header.opaque },
    });
  };

  const client = makeClient([dummyServer]);
  const val = await client.set("hello", "world", { cas: casToken });
  t.equal(true, val);
  t.equal(1, n, "Ensure set is called");
  n = 0;
});

test("SetSuccessfulWithoutOption", async function (t) {
  let n = 0;
  const dummyServer = makeDummyServer("dummyServer");
  dummyServer.write = function (requestBuf) {
    const request = parseMessage(requestBuf);
    t.equal("hello", request.key.toString());
    t.equal("world", request.val.toString());
    n += 1;
    dummyServer.respond({
      header: { status: 0, opaque: request.header.opaque },
    });
  };

  const client = makeClient([dummyServer]);
  const val = await client.set("hello", "world");
  t.equal(true, val);
  t.equal(1, n, "Ensure set is called");
});

test("SetWithExpiration", async function (t) {
  let n = 0;
  const dummyServer = makeDummyServer("dummyServer");
  dummyServer.write = function (requestBuf) {
    const request = parseMessage(requestBuf);
    t.equal("hello", request.key.toString());
    t.equal("world", request.val.toString());
    t.equal("\0\0\0\0\0\0\x04\0", request.extras.toString());
    n += 1;
    dummyServer.respond({
      header: { status: 0, opaque: request.header.opaque },
    });
  };

  const client = makeClient([dummyServer], { expires: 1024 });
  const val = await client.set("hello", "world", {});
  t.equal(true, val);
  t.equal(1, n, "Ensure set is called");
});

test("SetCASUnsuccessful", async (t) => {
  let n = 0;
  const casToken = "verycool";
  const dummyServer = makeDummyServer("dummyServer");
  dummyServer.write = function (requestBuf) {
    const request = parseMessage(requestBuf);
    t.equal("hello", request.key.toString());
    t.equal("world", request.val.toString());
    t.equal(casToken, request.header.cas?.toString());
    n += 1;
    dummyServer.respond({
      header: {
        status: constants.ResponseStatus.KEY_EXISTS,
        opaque: request.header.opaque,
      },
    });
  };

  const client = makeClient([dummyServer]);
  const val = await client.set("hello", "world", {
    cas: Buffer.from(casToken),
  });
  t.equal(false, val, "Returns false on CAS failure");
  t.equal(1, n, "Ensure set is called");
});

test("SetUnsuccessful", function (t) {
  let n = 0;
  const dummyServer = makeDummyServer("dummyServer");
  dummyServer.write = function (requestBuf) {
    const request = parseMessage(requestBuf);
    t.equal("hello", request.key.toString());
    t.equal("world", request.val.toString());
    n += 1;
    dummyServer.respond({
      header: { status: 3, opaque: request.header.opaque },
    });
  };

  const client = makeClient([dummyServer]);
  const assertor = function (err: Error | null, val: boolean | null) {
    t.equal(null, val);
    t.equal("MemJS SET: " + constants.responseStatusToString(3), err?.message);
    t.equal(1, n, "Ensure set is called");
  };
  return mustReject(t, client.set("hello", "world", {}), function (err) {
    assertor(err, null);
  });
});

test("SetError", function (t) {
  let n = 0;
  const dummyServer = makeDummyServer("dummyServer");
  dummyServer.write = function (requestBuf) {
    const request = parseMessage(requestBuf);
    t.equal("hello", request.key.toString());
    t.equal("world", request.val.toString());
    n += 1;
    dummyServer.error({
      name: "ErrorName",
      message: "This is an expected error.",
    });
  };

  const client = makeClient([dummyServer]);
  return mustReject(
    t,
    client.set("hello", "world"),
    function (err: Error | null) {
      t.notEqual(null, err);
      t.equal("This is an expected error.", err?.message);
      t.equal(2, n, "Ensure set is retried once");
      t.end();
    }
  );
});

test("SetError", function (t) {
  let n = 0;
  const dummyServer = makeDummyServer("dummyServer");
  dummyServer.write = function (requestBuf) {
    const request = parseMessage(requestBuf);
    t.equal("hello", request.key.toString());
    t.equal("world", request.val.toString());
    setTimeout(function () {
      n += 1;
      dummyServer.error({
        name: "ErrorName",
        message: "This is an expected error.",
      });
    }, 100);
  };

  const client = makeClient([dummyServer], { retries: 2 });
  return mustReject(t, client.set("hello", "world", {}), function (
    err /*, val */
  ) {
    t.equal(2, n, "Ensure set is retried once");
    t.ok(err, "Ensure callback called with error");
    t.equal("This is an expected error.", err?.message);
    t.end();
  });
});

test("SetErrorConcurrent", function (t) {
  let n = 0;
  let callbn1 = 0;
  let callbn2 = 0;
  const dummyServer = makeDummyServer("dummyServer");
  dummyServer.write = function (/* requestBuf */) {
    n += 1;
    dummyServer.error({
      name: "ErrorName",
      message: "This is an expected error.",
    });
  };

  const client = makeClient([dummyServer], { retries: 2 });
  mustReject(t, client.set("hello", "world", {}), function (err /*, val */) {
    t.ok(err, "Ensure callback called with error");
    t.equal("This is an expected error.", err?.message);
    callbn1 += 1;
    done();
  });

  mustReject(t, client.set("foo", "bar", {}), function (err /*, val */) {
    t.ok(err, "Ensure callback called with error");
    t.equal("This is an expected error.", err?.message);
    callbn2 += 1;
    done();
  });

  const done = (function () {
    let called = 0;
    return function () {
      called += 1;
      if (called < 2) return;
      t.equal(1, callbn1, "Ensure callback 1 is called once");
      t.equal(1, callbn2, "Ensure callback 2 is called once");
      t.equal(4, n, "Ensure error sent twice for each set call");
      t.end();
    };
  })();
});

test("SetUnicode", async function (t) {
  let n = 0;
  const dummyServer = makeDummyServer("dummyServer");
  dummyServer.write = function (requestBuf) {
    const request = parseMessage(requestBuf);
    t.equal("hello", request.key.toString());
    t.equal("éééoào", request.val.toString());
    n += 1;
    dummyServer.respond({
      header: { status: 0, opaque: request.header.opaque },
    });
  };

  const client = makeClient([dummyServer]);
  const val = await client.set("hello", "éééoào", {});
  t.equal(true, val);
  t.equal(1, n, "Ensure set is called");
});

test("SetSerialize", function (t) {
  let n = 0;
  let sn = 0;
  const dummyServer = makeDummyServer("dummyServer");
  dummyServer.write = function (requestBuf) {
    const request = parseMessage(requestBuf);
    t.equal("hello", request.key.toString());
    t.equal("serialized", request.val.toString());
    n += 1;
    dummyServer.respond({
      header: { status: 3, opaque: request.header.opaque },
    });
  };

  const client = makeClient([dummyServer], {
    serializer: {
      serialize: function (opcode, value, extras) {
        sn += 1;
        return { value: "serialized", extras: extras };
      },
      deserialize: function (opcode, value, extras) {
        return { value: value, extras: extras };
      },
    },
  });
  const assertor = function (err: Error | null, val: boolean | null) {
    t.equal(null, val);
    t.equal("MemJS SET: " + constants.responseStatusToString(3), err?.message);
    t.equal(1, n, "Ensure set is called");
    t.equal(1, sn, "Ensure serialization is called once");
  };
  return mustReject(t, client.set("hello", "world", {}), function (err) {
    assertor(err, null);
  });
});

test("AddSuccessful", async function (t) {
  let n = 0;
  const dummyServer = makeDummyServer("dummyServer");
  dummyServer.write = function (requestBuf) {
    const request = parseMessage(requestBuf);
    t.equal("hello", request.key.toString());
    t.equal("world", request.val.toString());
    t.equal("0000000000000400", request.extras.toString("hex"));
    n += 1;
    dummyServer.respond({
      header: { status: 0, opaque: request.header.opaque },
    });
  };

  const client = makeClient([dummyServer], { expires: 1024 });
  const val = await client.add("hello", "world", {});
  t.equal(true, val);
  t.equal(1, n, "Ensure add is called");
});

test("AddSuccessfulWithoutOption", async function (t) {
  let n = 0;
  const dummyServer = makeDummyServer("dummyServer");
  dummyServer.write = function (requestBuf) {
    const request = parseMessage(requestBuf);
    t.equal("hello", request.key.toString());
    t.equal("world", request.val.toString());
    t.equal("0000000000000400", request.extras.toString("hex"));
    n += 1;
    dummyServer.respond({
      header: { status: 0, opaque: request.header.opaque },
    });
  };

  const client = makeClient([dummyServer], { expires: 1024 });
  const val = await client.add("hello", "world", {});
  t.equal(true, val);
  t.equal(1, n, "Ensure add is called");
});

test("AddKeyExists", async function (t) {
  let n = 0;
  const dummyServer = makeDummyServer("dummyServer");
  dummyServer.write = function (requestBuf) {
    const request = parseMessage(requestBuf);
    t.equal("hello", request.key.toString());
    t.equal("world", request.val.toString());
    n += 1;
    dummyServer.respond({
      header: { status: 2, opaque: request.header.opaque },
    });
  };

  const client = makeClient([dummyServer]);
  const val = await client.add("hello", "world", {});
  t.equal(false, val);
  t.equal(1, n, "Ensure add is called");
});

test("AddSerializer", async function (t) {
  let n = 0;
  let sn = 0;
  const dummyServer = makeDummyServer("dummyServer");
  dummyServer.write = function (requestBuf) {
    const request = parseMessage(requestBuf);
    t.equal("hello", request.key.toString());
    t.equal("serialized", request.val.toString());
    t.equal("0000000100000400", request.extras.toString("hex"));
    n += 1;
    dummyServer.respond({
      header: { status: 0, opaque: request.header.opaque },
    });
  };

  const client = makeClient([dummyServer], {
    expires: 1024,
    serializer: {
      serialize: function (opcode, value, extras) {
        sn += 1;
        if (Buffer.isBuffer(extras)) {
          extras.writeUInt32BE(1, 0);
        }
        return { value: "serialized", extras: extras };
      },
      deserialize: function (opcode, value, extras) {
        return { value: value, extras: extras };
      },
    },
  });
  const val = await client.add("hello", "world", {});
  t.equal(true, val);
  t.equal(1, n, "Ensure add is called");
  t.equal(1, sn, "Ensure serialization is called once");
});

test("ReplaceSuccessful", async function (t) {
  let n = 0;
  const dummyServer = makeDummyServer("dummyServer");
  dummyServer.write = function (requestBuf) {
    const request = parseMessage(requestBuf);
    t.equal("hello", request.key.toString());
    t.equal("world", request.val.toString());
    t.equal("\0\0\0\0\0\0\x04\0", request.extras.toString());
    n += 1;
    dummyServer.respond({
      header: { status: 0, opaque: request.header.opaque },
    });
  };

  const client = makeClient([dummyServer], { expires: 1024 });
  const assertor = function (err: Error | null, val: boolean | null) {
    t.equal(null, err);
  };
  const val = await client.replace("hello", "world", {});
  t.equal(true, val);
  t.equal(1, n, "Ensure replace is called");
});

test("ReplaceSuccessfulWithoutOption", async function (t) {
  let n = 0;
  const dummyServer = makeDummyServer("dummyServer");
  dummyServer.write = function (requestBuf) {
    const request = parseMessage(requestBuf);
    t.equal("hello", request.key.toString());
    t.equal("world", request.val.toString());
    t.equal("\0\0\0\0\0\0\x04\0", request.extras.toString());
    n += 1;
    dummyServer.respond({
      header: { status: 0, opaque: request.header.opaque },
    });
  };

  const client = makeClient([dummyServer], { expires: 1024 });
  const val = await client.replace("hello", "world", {});
  t.equal(true, val);
  t.equal(1, n, "Ensure replace is called");
});

test("ReplaceKeyDNE", async function (t) {
  let n = 0;
  const dummyServer = makeDummyServer("dummyServer");
  dummyServer.write = function (requestBuf) {
    const request = parseMessage(requestBuf);
    t.equal("hello", request.key.toString());
    t.equal("world", request.val.toString());
    n += 1;
    dummyServer.respond({
      header: { status: 1, opaque: request.header.opaque },
    });
  };

  const client = makeClient([dummyServer]);
  const val = await client.replace("hello", "world", {});
  t.equal(false, val);
  t.equal(1, n, "Ensure replace is called");
});

test("DeleteSuccessful", async function (t) {
  let n = 0;
  const dummyServer = makeDummyServer("dummyServer");
  dummyServer.write = function (requestBuf) {
    const request = parseMessage(requestBuf);
    t.equal("hello", request.key.toString());
    n += 1;
    dummyServer.respond({
      header: { status: 0, opaque: request.header.opaque },
    });
  };

  const client = makeClient([dummyServer]);
  const val = await client.delete("hello");
  t.equal(true, val);
  t.equal(1, n, "Ensure delete is called");
});

test("DeleteKeyDNE", async function (t) {
  let n = 0;
  const dummyServer = makeDummyServer("dummyServer");
  dummyServer.write = function (requestBuf) {
    const request = parseMessage(requestBuf);
    t.equal("hello", request.key.toString());
    n += 1;
    dummyServer.respond({
      header: { status: 1, opaque: request.header.opaque },
    });
  };

  const client = makeClient([dummyServer]);
  const val = await client.delete("hello");
  t.equal(false, val);
  t.equal(1, n, "Ensure delete is called");
});

test("Flush", function (t) {
  let n = 0;
  const dummyServer = makeDummyServer("dummyServer");
  dummyServer.host = "example.com";
  dummyServer.port = 1234;
  dummyServer.write = function (requestBuf) {
    const request = parseMessage(requestBuf);
    t.equal(0x08, request.header.opcode);
    n += 1;
    dummyServer.respond({
      header: { status: 1, opaque: request.header.opaque },
    });
  };

  const client = makeClient([dummyServer, dummyServer]);
  const assertor = function (
    err: Error | null,
    results: Record<string, boolean | Error>
  ) {
    t.equal(null, err);
    t.equal(true, results["example.com:1234"]);
    t.equal(2, n, "Ensure flush is called for each server");
  };
  client.flush(assertor);
  n = 0;
  return client.flush().then(function (results) {
    assertor(null, results);
  });
});

test("Stats", function (t) {
  let n = 0;
  const dummyServer = makeDummyServer("dummyServer");
  dummyServer.host = "myhostname";
  dummyServer.port = 5544;
  dummyServer.write = function (requestBuf) {
    const request = parseMessage(requestBuf);
    t.equal(0x10, request.header.opcode);
    n += 1;
    dummyServer.respond({
      header: { status: 0, totalBodyLength: 9, opaque: request.header.opaque },
      key: "bytes",
      val: "1432",
    });
    dummyServer.respond({
      header: { status: 0, totalBodyLength: 9, opaque: request.header.opaque },
      key: "count",
      val: "5432",
    });
    dummyServer.respond({
      header: { status: 0, totalBodyLength: 0, opaque: request.header.opaque },
    });
  };

  const client = makeClient([dummyServer]);
  client.stats(function (err: Error | null, server, stats) {
    t.equal(null, err);
    t.equal("1432", stats?.bytes);
    t.equal("5432", stats?.count);
    t.equal("myhostname:5544", server);
    t.equal(1, n, "Ensure stats is called");
    t.end();
  });
});

test("IncrementSuccessful", function (t) {
  let n = 0;
  let callbn = 0;
  const dummyServer = makeDummyServer("dummyServer");

  const expectedExtras = [
    "\0\0\0\0\0\0\0\x05\0\0\0\0\0\0\0\0\0\0\0\0",
    "\0\0\0\0\0\0\0\x05\0\0\0\0\0\0\0\x03\0\0\0\0",
  ];

  dummyServer.write = function (requestBuf) {
    const request = parseMessage(requestBuf);
    t.equal(5, request.header.opcode);
    t.equal("number-increment-test", request.key.toString());
    t.equal("", request.val.toString());
    t.equal(expectedExtras[n], request.extras.toString());
    n += 1;
    process.nextTick(function () {
      const value = Buffer.alloc(8);
      value.writeUInt32BE(request.header.opcode + 1, 4);
      value.writeUInt32BE(0, 0);
      dummyServer.respond({
        header: { status: 0, opaque: request.header.opaque },
        val: value,
      });
    });
  };

  const client = makeClient([dummyServer]);
  client
    .increment("number-increment-test", 5, {})
    .then(function ({ success, value: val }) {
      callbn += 1;
      t.equal(true, success);
      t.equal(6, val);
      done();
    });

  client
    .increment("number-increment-test", 5, { initial: 3 })
    .then(function ({ success, value: val }) {
      callbn += 1;
      t.equal(true, success);
      t.equal(6, val);
      done();
    });

  const done = (function () {
    let called = 0;
    return function () {
      called += 1;
      if (called < 2) return;
      t.equal(2, n, "Ensure increment is called twice");
      t.equal(2, callbn, "Ensure callback is called twice");
      t.end();
    };
  })();
});

test("DecrementSuccessful", function (t) {
  let n = 0;
  const dummyServer = makeDummyServer("dummyServer");
  dummyServer.write = function (requestBuf) {
    const request = parseMessage(requestBuf);
    t.equal(6, request.header.opcode);
    t.equal("number-decrement-test", request.key.toString());
    t.equal("", request.val.toString());
    t.equal(
      "\0\0\0\0\0\0\0\x05\0\0\0\0\0\0\0\0\0\0\0\0",
      request.extras.toString()
    );
    n += 1;
    process.nextTick(function () {
      const value = Buffer.alloc(8);
      value.writeUInt32BE(request.header.opcode, 4);
      value.writeUInt32BE(0, 0);
      dummyServer.respond({
        header: { status: 0, opaque: request.header.opaque },
        val: value,
      });
    });
  };

  const client = makeClient([dummyServer]);
  return client
    .decrement("number-decrement-test", 5, {})
    .then(function ({ success, value: val }) {
      t.equal(true, success);
      t.equal(6, val);
      t.equal(1, n, "Ensure decr is called");
    });
});

test("DecrementSuccessfulWithoutOption", function (t) {
  let n = 0;
  const dummyServer = makeDummyServer("dummyServer");
  dummyServer.write = function (requestBuf) {
    const request = parseMessage(requestBuf);
    t.equal(6, request.header.opcode);
    t.equal("number-decrement-test", request.key.toString());
    t.equal("", request.val.toString());
    t.equal(
      "\0\0\0\0\0\0\0\x05\0\0\0\0\0\0\0\0\0\0\0\0",
      request.extras.toString()
    );
    n += 1;
    process.nextTick(function () {
      const value = Buffer.alloc(8);
      value.writeUInt32BE(request.header.opcode, 4);
      value.writeUInt32BE(0, 0);
      dummyServer.respond({
        header: { status: 0, opaque: request.header.opaque },
        val: value,
      });
    });
  };

  const client = makeClient([dummyServer]);
  client
    .decrement("number-decrement-test", 5, {})
    .then(function ({ success, value: val }) {
      t.equal(true, success);
      t.equal(6, val);
      t.equal(1, n, "Ensure decr is called");
      t.end();
    });
});

test("AppendSuccessful", function (t) {
  let n = 0;
  const dummyServer = makeDummyServer("dummyServer");
  dummyServer.write = function (requestBuf) {
    const request = parseMessage(requestBuf);
    t.equal("hello", request.key.toString());
    t.equal("world", request.val.toString());
    n += 1;
    dummyServer.respond({
      header: { status: 0, opaque: request.header.opaque },
    });
  };

  const client = makeClient([dummyServer], { expires: 1024 });
  client.append("hello", "world").then(function (val) {
    t.equal(true, val);
    t.equal(1, n, "Ensure append is called");
    t.end();
  });
});

test("AppendKeyDNE", function (t) {
  let n = 0;
  const dummyServer = makeDummyServer("dummyServer");
  dummyServer.write = function (requestBuf) {
    const request = parseMessage(requestBuf);
    t.equal("hello", request.key.toString());
    t.equal("world", request.val.toString());
    n += 1;
    dummyServer.respond({
      header: { status: 1, opaque: request.header.opaque },
    });
  };

  const client = makeClient([dummyServer]);
  client.append("hello", "world").then(function (val) {
    t.equal(false, val);
    t.equal(1, n, "Ensure append is called");
    t.end();
  });
});

test("PrependSuccessful", function (t) {
  let n = 0;
  const dummyServer = makeDummyServer("dummyServer");
  dummyServer.write = function (requestBuf) {
    const request = parseMessage(requestBuf);
    t.equal("hello", request.key.toString());
    t.equal("world", request.val.toString());
    n += 1;
    dummyServer.respond({
      header: { status: 0, opaque: request.header.opaque },
    });
  };

  const client = makeClient([dummyServer], { expires: 1024 });
  client.prepend("hello", "world").then(function (val) {
    t.equal(true, val);
    t.equal(1, n, "Ensure prepend is called");
    t.end();
  });
});

test("PrependKeyDNE", function (t) {
  let n = 0;
  const dummyServer = makeDummyServer("dummyServer");
  dummyServer.write = function (requestBuf) {
    const request = parseMessage(requestBuf);
    t.equal("hello", request.key.toString());
    t.equal("world", request.val.toString());
    n += 1;
    dummyServer.respond({
      header: { status: 1, opaque: request.header.opaque },
    });
  };

  const client = makeClient([dummyServer]);
  client.prepend("hello", "world").then(function (val) {
    t.equal(false, val);
    t.equal(1, n, "Ensure prepend is called");
    t.end();
  });
});

test("TouchSuccessful", function (t) {
  let n = 0;
  const dummyServer = makeDummyServer("dummyServer");
  dummyServer.write = function (requestBuf) {
    const request = parseMessage(requestBuf);
    t.equal("hello", request.key.toString());
    t.equal("", request.val.toString());
    t.equal("\0\0\x04\0", request.extras.toString());
    n += 1;
    dummyServer.respond({
      header: { status: 0, opaque: request.header.opaque },
    });
  };

  const client = makeClient([dummyServer]);
  client.touch("hello", 1024).then(function (val) {
    t.equal(true, val);
    t.equal(1, n, "Ensure touch is called");
    t.end();
  });
});

test("TouchKeyDNE", function (t) {
  let n = 0;
  const dummyServer = makeDummyServer("dummyServer");
  dummyServer.write = function (requestBuf) {
    const request = parseMessage(requestBuf);
    t.equal("hello", request.key.toString());
    t.equal("", request.val.toString());
    t.equal("\0\0\x04\0", request.extras.toString());
    n += 1;
    dummyServer.respond({
      header: { status: 1, opaque: request.header.opaque },
    });
  };

  const client = makeClient([dummyServer]);
  client.touch("hello", 1024).then(function (val) {
    t.equal(false, val);
    t.equal(1, n, "Ensure touch is called");
    t.end();
  });
});

// test('Failover', function(t) {
//   let n1 = 0;
//   let n2 = 0;
//   const dummyServer1 = makeDummyServer('dummyServer');
//   dummyServer1.write = function(/* requestBuf*/) {
//     n1 += 1;
//     dummyServer1.error(new Error('connection failure'));
//   };
//   const dummyServer2 = makeDummyServer('dummyServer');
//   dummyServer2.write = function(requestBuf) {
//     n2 += 1;
//     const request = parseMessage(requestBuf);
//     dummyServer2.respond({header: {status: 0, opaque: request.header.opaque}});
//   };

//   const client = makeClient([dummyServer1, dummyServer2], {failover: true});
//   client.get('\0', function(err/*, val */){
//     t.equal(null, err);
//     t.equal(2, n1);
//     t.equal(1, n2);
//     t.end();
//   });

// });

test("Very Large Client Seq", function (t) {
  let n = 0;
  const dummyServer = makeDummyServer("dummyServer");
  dummyServer.write = function (requestBuf) {
    const request = parseMessage(requestBuf);
    t.equal("hello", request.key.toString());
    t.equal("world", request.val.toString());
    t.equal("0000000000000400", request.extras.toString("hex"));
    n += 1;
    dummyServer.respond({
      header: { status: 0, opaque: request.header.opaque },
    });
  };

  const client = makeClient([dummyServer], { expires: 1024 });
  client.seq = Math.pow(2, 33);
  const assertor = function (err: Error | null, val: boolean | null) {
    t.equal(null, err);
    t.equal(true, val);
    t.equal(1, n, "Ensure add is called");
  };
  return client.add("hello", "world", {}).then(function (success) {
    assertor(null, success);
  });
});

const makeDummyVersionServer = (
  t: TapTestType,
  serverKey: string,
  version: string
) => {
  const dummyServer = makeDummyServer(serverKey);
  dummyServer.write = function (requestBuf) {
    const request = parseMessage(requestBuf);
    t.deepEqual(Buffer.from(""), request.key);
    dummyServer.respond({
      header: { status: 0, opaque: request.header.opaque },
      val: version,
      extras: "flagshere",
    });
  };
  return dummyServer;
};

test("VersionSuccessful", function (t) {
  let n = 0;

  const dummyServer = makeDummyVersionServer(t, "dummyServer", "1.3.1");
  dummyServer.write = function (requestBuf) {
    const request = parseMessage(requestBuf);
    t.deepEqual(Buffer.from(""), request.key);
    n += 1;
    dummyServer.respond({
      header: { status: 0, opaque: request.header.opaque },
      val: "1.3.1",
      extras: "flagshere",
    });
  };

  const client = makeClient([dummyServer]);
  const assertor = function (err: Error | null, val: any) {
    t.equal("1.3.1", val);
    t.equal(null, err);
    t.equal(n, 1, "Ensure version is called");
  };

  return client.version().then(function (res) {
    assertor(null, res.value);
  });
});

tap.only("VersionError", function (t) {
  const dummyServer = makeDummyServer("dummyServer");
  dummyServer.write = function () {
    dummyServer.error({
      name: "ErrorName",
      message: "This is an expected error.",
    });
  };

  const client = makeClient([dummyServer]);
  const assertor = function (
    err: Error | null,
    value?: string | Buffer | null,
    flags?: any
  ) {
    t.notEqual(null, err);
    t.equal("This is an expected error.", err?.message);
  };

  return mustReject(t, client.version(), function (err) {
    assertor(err);
  });
});

test("VersionAllSuccessful", function (t) {
  const dummyServer1 = makeDummyVersionServer(t, "dummyServer1", "1.0.0");
  const dummyServer2 = makeDummyVersionServer(t, "dummyServer2", "2.0.0");
  const dummyServer3 = makeDummyVersionServer(t, "dummyServer3", "3.0.0");

  const client = makeClient([dummyServer1, dummyServer2, dummyServer3]);
  const assertor = function (
    err: Error | null,
    val?: Record<string, string | Buffer | null> | null
  ) {
    t.deepEqual(
      {
        "dummyServer1:undefined": "1.0.0",
        "dummyServer2:undefined": "2.0.0",
        "dummyServer3:undefined": "3.0.0",
      },
      val
    );
    t.equal(null, err);
  };

  return client.versionAll().then(function (res) {
    assertor(null, res.values);
  });
});

tap.only("VersionAllSomeFailed", function (t) {
  const dummyServer1 = makeDummyVersionServer(t, "dummyServer1", "1.0.0");
  const dummyServer2 = makeDummyVersionServer(t, "dummyServer2", "2.0.0");
  dummyServer2.write = function () {
    dummyServer2.error({
      name: "ErrorName",
      message: "This is an expected error.",
    });
  };
  const dummyServer3 = makeDummyVersionServer(t, "dummyServer3", "3.0.0");

  const client = makeClient([dummyServer1, dummyServer2, dummyServer3]);
  const assertor = function (err: Error | null) {
    t.notEqual(null, err);
    t.equal("This is an expected error.", err?.message);
  };

  return mustReject(t, client.versionAll(), function (err) {
    assertor(err);
  });
});
