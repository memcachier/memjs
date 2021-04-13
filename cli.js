const MemJS = require(".");
const client = MemJS.Client.create();

let i = 0;

function next(promise) {
  const id = i++;
  const varname = `r${id}`;

  const assign = (r) => {
    global[varname] = r;
    global["r"] = r;
  };

  if (promise.then) {
    promise.then(
      (r) => {
        console.log(`r${id} = resolved`, r);
        assign(r);
      },
      (r) => {
        console.log(`r${id} = rejected`, r);
        assign(r);
      }
    );
  } else {
    console.log(`r${id} =`, promise);
    assign(promise);
  }
}

Object.assign(global, {
  MemJS,
  client,
  next,
  p: next,
});

console.log(`
Run as node --inspect cli.js,
then open Chrome inspector up and click the little node icon.

MemJS: memjs library export
client: a client connected to localhost:11211
p: a function to resolve promises

Example:
  p(client.get('foo'))
  r1.cas.toString()
`);

setInterval(() => {}, 5000);
