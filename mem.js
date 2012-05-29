var header = require("./header");
var errors = require("./protocol").errors;
var Server = require("./server").Server;

var Client = function(servers) {
  this.servers = servers;
}

var hashCode = function(str) {
  for(var ret = 0, i = 0, len = str.length; i < len; i++) {
    ret = (31 * ret + str.charCodeAt(i)) << 0;
  }
  return ret;
};

Client.prototype = {
  server: function(key) {
    return this.servers[hashCode(key) % this.servers.length];
  },
  get: function(key, callback) {
    var buf = new Buffer(24 + key.length);
    var requestHeader = {
      magic: 0x80,
      opcode: 0,
      keyLength: key.length,
      extrasLength: 0,
      totalBodyLength: key.length
    };
    header.toBuffer(requestHeader).copy(buf);
    buf.write(key, 24)
    var serv = this.server(key);
    serv.once("response", function(response) {
      switch (response.header.status) {
      case  0:
        callback(response.value, response.extras)
        break;
      default:
        console.log(errors[response.header.status])
        callback();
      }
    });
    serv.write(buf);
  },
  set: function(key, value, callback) {
    var buf = new Buffer(24 + key.length + 8 + value.length);
    buf.fill();
    var requestHeader = {
      magic: 0x80,
      opcode: 1,
      keyLength: key.length,
      extrasLength: 8,
      totalBodyLength: key.length + value.length + 8
    };
    header.toBuffer(requestHeader).copy(buf);
    buf.writeUInt32BE(0, 24);
    buf.writeUInt32BE(0, 28);
    buf.write(key, 32);
    buf.write(value, 32 + key.length);
    var serv = this.server(key);
    serv.once("response", function(response) {
      switch (response.header.status) {
      case  0:
        callback(true)
        break;
      default:
        console.log(errors[response.header.status])
        callback();
      }
    });
    serv.write(buf);
  }
}

exports.Client = Client;
exports.Server = Server;
