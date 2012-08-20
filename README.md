MemJS [![Build Status](https://securetravis-ci.org/alevy/memjs.png)](http://travis-ci.org/alevy/memjs)
=====

MemJS is a pure Node.js client library for accessing the
[MemCachier](http://memcachier.com/) service and other memcache servers. It
uses the binary protocol and support SASL authentication.

_NOTE_: while memjs works with MemCachier, MemCachier is configured only to
accept connections from authorized hosts (e.g. Heroku's servers). For local
development, use memcache -- no code changes are required to work with
MemCachier once the app is deployed. See below for local installation
instructions.

## Supported Node.js versions ##

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

## Usage ##

You can start using MemJS immediately from the node console:

    $ var memjs = require('memjs')
    $ var client = memjs.Client.create()
    $ client.get('hello', console.log)

## Configuration ##

MemJS understands the following environment variables:

* `MEMCACHIER_SERVERS` - used to determine which servers to connect to. Should be a comma separated list of _[hostname:port]_.
* `MEMCACHIER_USERNAME` - if present with `MEMCACHIER_PASSWORD`, MemJS will try to authenticated to the server using SASL.
* `MEMCACHIER_PASSWORD` - if present with `MEMCACHIER_USERNAME`, MemJS will try to authenticated to the server using SASL.
* `MEMCACHE_USERNAME` - used if `MEMCACHIER_USERNAME` is not present
* `MEMCACHE_PASSWORD` - used if `MEMCACHIER_PASSWORD` is not present

Environment variables are only used as a fallback for explicit parameters.

## TODOS ##

* Add more commands (increment, decrement, flush)
* Support flags
* Support CAS

## Copyright ##

Copyright (c) 2012 Amit Levy, MemCachier. See LICENSE for details.
