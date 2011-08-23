# node-bitcoin-exit

Public API that enables thin clients to communicate with the Bitcoin
network.

# Installation

First you need to [install
node-bitcoin-p2p](https://github.com/bitcoinjs/node-bitcoin-p2p).

Make sure you download the block chain after configuring
`node-bitcoin-p2p`.

Then, clone `node-bitcoin-exit`.

``` sh
git clone git://github.com/bitcoinjs/node-bitcoin-exit.git --recursive
```

# Usage

Start the server with

``` sh
node server.js
```

We recommend using [forever](https://github.com/indexzero/forever) to
make sure the server is automatically restarted in case of an error.

``` sh
forever start server.js
```

# Status

First permanent deployment is online at https://exit.trucoin.com:3125/

Prototype software, use at your own peril.
