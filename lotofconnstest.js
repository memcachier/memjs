#! node
const MemJS = require(".");

async function nextTick() {
  return new Promise((resolve) => setImmediate(resolve));
}

const clients = [];

async function body() {
  // local memcached is default 1024 max connections
  for (let i = 0; i < 1025; i++) {
    const client = MemJS.Client.create(undefined, {timeout: 1, connTimeout: 2, retries: 1});
    console.log("created", i);

    client.servers.forEach((server) => {
      server.onConnect((sock) => {
        console.log("connected", i);

        sock.once("close", (err) => {
          console.log("closed", i, err);
        })
        sock.once("error", (err) => {
          console.log("error handler", i, err);
        })
      })
    })

    try {
      await client.get("foo");
      console.log(i)
    } catch (error) {
      console.log("error", error, i);
    }
    
    clients.push(client);
  }

}

async function main() {
  try {
    await body();
    console.log("smoketest ok");
  } catch (error) {
    console.error("fatal", error);
    process.exit(1);
  } finally {
    clients.forEach((client) => {
      client.servers.forEach((server) => server._socket?.removeAllListeners("close"));
      client.quit()
    });
  }
}

main();
