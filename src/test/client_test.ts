import tap from "tap";
const test = tap.test;

const errors = require("../memjs/protocol").errors;
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

test("GetSuccessful", function (t) {
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
  const assertor = function (err: Error | null, val: MemJS.GetResult | null) {
    if (!val) {
      t.ok(val, "must return value");
      return;
    }
    t.equal("world", val.value);
    t.equal("flagshere", val.extras);
    t.equal(casToken, val.cas);
    t.equal(null, err);
    t.equal(1, n, "Ensure get is called");
  };
  client.get("hello", assertor);
  n = 0;
  return client.get("hello").then(function (res) {
    assertor(null, res);
  });
});

test("GetNotFound", function (t) {
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
  const assertor = function (err: Error | null, val: MemJS.GetResult | null) {
    t.equal(null, val);
    t.equal(1, n, "Ensure get is called");
  };
  client.get("hello", assertor);
  n = 0;
  return client.get("hello").then(function (res) {
    assertor(null, res);
    t.end();
  });
});

test("GetSerializer", function (t) {
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
  const assertor = function (err: Error | null, value: MemJS.GetResult | null) {
    if (!value) {
      t.ok(value, "must return value");
      return;
    }
    t.equal("deserialized", value.value);
    t.equal("flagshere", value.extras);
    t.equal(casToken, value.cas);
    t.equal(null, err);
    t.equal(1, n, "Ensure get is called");
    t.equal(1, dn, "Ensure deserialization is called once");
  };
  client.get("hello", assertor);
  n = 0;
  dn = 0;
  return client.get("hello").then(function (res) {
    assertor(null, res);
  });
});

tap.only("GetMultiSuccessful_SingleBackend", function (t) {
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
  const assertor = function (
    err: Error | null,
    result: MemJS.GetMultiResult | null
  ) {
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
    t.equal(null, err);
    t.equal(1, n, "Ensure getMulti is called");
  };
  client.getMulti(["hello1", "hello2", "hello3"], assertor);
  testAllCallbacksEmpty(t, dummyServer);

  n = 0;
  return client.getMulti(["hello1", "hello2", "hello3"]).then(function (res) {
    assertor(null, res);
  });
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

test("GetMultiSuccessful_MultiBackend", function (t) {
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

  const assertor = function (
    err: Error | null,
    val: MemJS.GetMultiResult | null
  ) {
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
    console.log(val);
    t.equal(null, err);
  };
  client.getMulti(["hello1", "hello2", "hello3", "hello4"], assertor);
  testAllCallbacksEmpty(t, dummyServer1);
  testAllCallbacksEmpty(t, dummyServer2);

  return client
    .getMulti(["hello1", "hello2", "hello3", "hello4"])
    .then(function (res) {
      assertor(null, res);
    });
});

test("GetMultiSuccessful_MissingKeys_MultiBackend", function (t) {
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

  const assertor = function (
    err: Error | null,
    val: MemJS.GetMultiResult | null
  ) {
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
    t.equal(null, err);
  };
  client.getMulti(["hello1", "hello2", "hello3", "hello4"], assertor);
  testAllCallbacksEmpty(t, dummyServer1);
  testAllCallbacksEmpty(t, dummyServer2);

  return client
    .getMulti(["hello1", "hello2", "hello3", "hello4"])
    .then(function (res) {
      assertor(null, res);
    });
});

test("GetMultiError_MultiBackend", function (t) {
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

  const assertor = function (err: Error | null) {
    t.notEqual(null, err);
    t.equal("This is an expected error.", err?.message);
  };
  client.getMulti(["hello1", "hello2", "hello3", "hello4"], assertor);
  testAllCallbacksEmpty(t, dummyServer1);
  testAllCallbacksEmpty(t, dummyServer2);

  return client
    .getMulti(["hello1", "hello2", "hello3", "hello4"])
    .catch(function (err) {
      assertor(err);
      return true;
    });
});

test("GetMultiSuccessfulWithMissingKeys", function (t) {
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
    t.equal(null, err);
  };
  client.getMulti(["hello1", "hello2", "hello3"], assertor);
  testAllCallbacksEmpty(t, dummyServer);
  return client.getMulti(["hello1", "hello2", "hello3"]).then(function (res) {
    assertor(null, res);
  });
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
    t.equal("This is an expected error.", err?.message);
  };
  client.getMulti(["hello1", "hello2", "hello3"], assertor);
  testAllCallbacksEmpty(t, dummyServer);

  return client.getMulti(["hello1", "hello2", "hello3"]).catch(function (err) {
    assertor(err);
    return true;
  });
});

test("SetSuccessful", function (t) {
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
  const assertor = function (err: Error | null, val: boolean | null) {
    t.equal(true, val);
    t.equal(null, err);
    t.equal(1, n, "Ensure set is called");
  };
  client.set("hello", "world", { cas: casToken }, assertor);
  n = 0;
  return client
    .set("hello", "world", { cas: casToken })
    .then(function (success) {
      assertor(null, success);
    });
});

test("SetSuccessfulWithoutOption", function (t) {
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
  client.set("hello", "world", {}, function (err: Error | null, val) {
    t.equal(true, val);
    t.equal(null, err);
    t.equal(1, n, "Ensure set is called");
    t.end();
  });
});

test("SetPromiseWithoutOption", function (t) {
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
  return client.set("hello", "world").then(function (val) {
    t.equal(true, val);
    t.equal(1, n, "Ensure set is called");
    t.end();
  });
});

test("SetWithExpiration", function (t) {
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
  client.set("hello", "world", {}, function (err: Error | null, val) {
    t.equal(null, err);
    t.equal(true, val);
    t.equal(1, n, "Ensure set is called");
    t.end();
  });
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
    t.equal("MemJS SET: " + errors[3], err?.message);
    t.equal(1, n, "Ensure set is called");
  };
  client.set("hello", "world", {}, assertor);
  n = 0;
  return client.set("hello", "world", {}).catch(function (err) {
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
  client.set("hello", "world", {}, function (err: Error | null, val) {
    t.notEqual(null, err);
    t.equal("This is an expected error.", err?.message);
    t.equal(null, val);
    t.equal(2, n, "Ensure set is retried once");
    t.end();
  });
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
  client.set("hello", "world", {}, function (err /*, val */) {
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
  client.set("hello", "world", {}, function (err /*, val */) {
    t.ok(err, "Ensure callback called with error");
    t.equal("This is an expected error.", err?.message);
    callbn1 += 1;
    done();
  });

  client.set("foo", "bar", {}, function (err /*, val */) {
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

test("SetUnicode", function (t) {
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
  client.set("hello", "éééoào", {}, function (err: Error | null, val) {
    t.equal(true, val);
    t.equal(1, n, "Ensure set is called");
    t.end();
  });
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
    t.equal("MemJS SET: " + errors[3], err?.message);
    t.equal(1, n, "Ensure set is called");
    t.equal(1, sn, "Ensure serialization is called once");
  };
  client.set("hello", "world", {}, assertor);
  n = 0;
  sn = 0;
  return client.set("hello", "world", {}).catch(function (err) {
    assertor(err, null);
  });
});

test("AddSuccessful", function (t) {
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
  const assertor = function (err: Error | null, val: boolean | null) {
    t.equal(null, err);
    t.equal(true, val);
    t.equal(1, n, "Ensure add is called");
  };
  client.add("hello", "world", {}, assertor);
  n = 0;
  return client.add("hello", "world", {}).then(function (success) {
    assertor(null, success);
  });
});

test("AddSuccessfulWithoutOption", function (t) {
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
  client.add("hello", "world", {}, function (err: Error | null, val) {
    t.equal(null, err);
    t.equal(true, val);
    t.equal(1, n, "Ensure add is called");
    t.end();
  });
});

test("AddKeyExists", function (t) {
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
  client.add("hello", "world", {}, function (err: Error | null, val) {
    t.equal(null, err);
    t.equal(false, val);
    t.equal(1, n, "Ensure add is called");
    t.end();
  });
});

test("AddSerializer", function (t) {
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
  const assertor = function (err: Error | null, val: boolean | null) {
    t.equal(null, err);
    t.equal(true, val);
    t.equal(1, n, "Ensure add is called");
    t.equal(1, sn, "Ensure serialization is called once");
  };
  client.add("hello", "world", {}, assertor);
  n = 0;
  sn = 0;
  return client.add("hello", "world", {}).then(function (success) {
    assertor(null, success);
  });
});

test("ReplaceSuccessful", function (t) {
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
    t.equal(true, val);
    t.equal(1, n, "Ensure replace is called");
  };
  client.replace("hello", "world", {}, assertor);
  n = 0;
  const replaceP = client.replace("hello", "world", {});
  if (!replaceP) {
    return t.true(replaceP);
  } else {
    return replaceP.then(function (success) {
      assertor(null, success);
    });
  }
});

test("ReplaceSuccessfulWithoutOption", function (t) {
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
  client.replace("hello", "world", {}, function (err: Error | null, val) {
    t.equal(null, err);
    t.equal(true, val);
    t.equal(1, n, "Ensure replace is called");
    t.end();
  });
});

test("ReplaceKeyDNE", function (t) {
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
  client.replace("hello", "world", {}, function (err: Error | null, val) {
    t.equal(null, err);
    t.equal(false, val);
    t.equal(1, n, "Ensure replace is called");
    t.end();
  });
});

test("DeleteSuccessful", function (t) {
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
  const assertor = function (err: Error | null, val: boolean | null) {
    t.equal(null, err);
    t.equal(true, val);
    t.equal(1, n, "Ensure delete is called");
  };
  client.delete("hello", assertor);
  n = 0;
  return client.delete("hello").then(function (success) {
    assertor(null, success);
  });
});

test("DeleteKeyDNE", function (t) {
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
  client.delete("hello", function (err: Error | null, val) {
    t.equal(null, err);
    t.equal(false, val);
    t.equal(1, n, "Ensure delete is called");
    t.end();
  });
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
  client.increment("number-increment-test", 5, {}, function (
    err: Error | null,
    success,
    val
  ) {
    callbn += 1;
    t.equal(true, success);
    t.equal(6, val);
    t.equal(null, err);
    done();
  });

  client.increment("number-increment-test", 5, { initial: 3 }, function (
    err: Error | null,
    success,
    val
  ) {
    callbn += 1;
    t.equal(true, success);
    t.equal(6, val);
    t.equal(null, err);
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
  client.decrement("number-decrement-test", 5, {}, function (
    err: Error | null,
    success,
    val
  ) {
    t.equal(true, success);
    t.equal(6, val);
    t.equal(null, err);
    t.equal(1, n, "Ensure decr is called");
    t.end();
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
  client.decrement("number-decrement-test", 5, {}, function (
    err: Error | null,
    success,
    val
  ) {
    t.equal(true, success);
    t.equal(6, val);
    t.equal(null, err);
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
  client.append("hello", "world", function (err: Error | null, val) {
    t.equal(null, err);
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
  client.append("hello", "world", function (err: Error | null, val) {
    t.equal(null, err);
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
  client.prepend("hello", "world", function (err: Error | null, val) {
    t.equal(null, err);
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
  client.prepend("hello", "world", function (err: Error | null, val) {
    t.equal(null, err);
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
  client.touch("hello", 1024, function (err: Error | null, val) {
    t.equal(null, err);
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
  client.touch("hello", 1024, function (err: Error | null, val) {
    t.equal(null, err);
    t.equal(false, val);
    t.equal(1, n, "Ensure ptouch is called");
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
  client.add("hello", "world", {}, assertor);
  n = 0;
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
  const assertor = function (err: Error | null, val: any, flags: string) {
    t.equal("1.3.1", val);
    t.equal("flagshere", flags);
    t.equal(null, err);
    t.equal(n, 1, "Ensure version is called");
  };

  client.version(assertor);
  n = 0;

  return client.version().then(function (res) {
    assertor(null, res.value, res.flags);
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

  client.version(assertor);
  return client.version().catch(function (err) {
    assertor(err);
    return true;
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

  client.versionAll(assertor);

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

  client.versionAll(assertor);

  return client.versionAll().catch(function (err) {
    assertor(err);
  });
});
