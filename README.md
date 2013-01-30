MemJS
=====

[![Build Status](https://secure.travis-ci.org/alevy/memjs.png)](http://travis-ci.org/alevy/memjs?branch=master)

MemJS is a pure Node.js client library for using memcache, in particular, the
[MemCachier](http://memcachier.com/) service. It
uses the binary protocol and support SASL authentication.

## TOC

  1. [Requirements](#requirements)
  2. [Installation](#installation)
  3. [Configuration](#configuration)
  4. [Usage](#usage)
  5. [How to help](#contributing)

## Requirements

### Supported Node.js versions ###

MemJS is tested to work with version 0.6 or higher of Node.js.

## Installation ##

MemJS is available from the npm registry:

    $ npm install memjs

To install from git:

    $ git clone git://github.com/alevy/memjs.git
    $ cd memjs
    $ npm link

MemJS was designed for the MemCachier memcache service but will work with any
memcache server that speaks the binary protocol. Many software repositories
have a version of memcacached available for installation:

### Ubuntu ###

    $ apt-get install memcached

### OS X ###

    $ brew install memcached

## Configuration ##

MemJS understands the following environment variables:

* `MEMCACHIER_SERVERS` - used to determine which servers to connect to. Should be a comma separated list of _[hostname:port]_.
* `MEMCACHIER_USERNAME` - if present with `MEMCACHIER_PASSWORD`, MemJS will try to authenticated to the server using SASL.
* `MEMCACHIER_PASSWORD` - if present with `MEMCACHIER_USERNAME`, MemJS will try to authenticated to the server using SASL.
* `MEMCACHE_USERNAME` - used if `MEMCACHIER_USERNAME` is not present
* `MEMCACHE_PASSWORD` - used if `MEMCACHIER_PASSWORD` is not present

Environment variables are only used as a fallback for explicit parameters.

## Usage ##

You can start using MemJS immediately from the node console:

    $ var memjs = require('memjs')
    $ var client = memjs.Client.create()
    $ client.get('hello', console.log)

## Contributing

The best way to contribut to the project is by reporting bugs and testing unpublished
versions. If you have a staging or development app, the easiest way to do this is
using the git repository as your `memjs` package dependency---in `package.json`:
    
    {
      "name": "MyAppName",
      ...
      "dependencies": {
        ...
        "memjs": "git://github.com/alevy/memjs.git#master"
        ...
      }
    }
    
If you find a bug, please report as an [issue](https://github.com/alevy/memjs/issues/new).
If you fix it, please don't hesitate to send a pull request on GitHub or via
[e-mail](http://www.kernel.org/pub/software/scm/git/docs/git-request-pull.html).

Feature suggestions are also welcome! These includes suggestions about syntax and interface
design.

Finally, a great way to contribute is to implement a feature that's missing and send a pull
request. The list below contains some planned features that have not been addressed yet. You
can also implement a feature not a list if you think it would be good.

### TODOS ###

* Add more commands (increment, decrement, flush)
* Support flags
* Support CAS
* Consistent hashing for keys and/or pluggable hashing algorithm

## Copyright ##

Copyright (c) 2012 Amit Levy, MemCachier. See LICENSE for details.
