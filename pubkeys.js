var sys = require('sys');
require('buffertools');
var uuid = require('node-uuid');
var Module = require('./webservice').Module;
var bitcoin = require('bitcoin-p2p');
var Util = bitcoin.Util;

var PubkeysCache = function () {
	events.EventEmitter.call(this);
};

sys.inherits(PubkeysCache, events.EventEmitter);

var PubkeysData = function () {
	events.EventEmitter.call(this);
};

sys.inherits(PubkeysData, events.EventEmitter);

var cache = new PubkeysCache();

var Pubkeys = exports.Pubkeys = Module.define({
	title: "Welcome to your webservice!",
	name: "public keys service",
	version: "0.1.0",
	construct: function (params) {
		this.node = params.node;
	},
	schema: {
		'node': { type: bitcoin.Node, required: true }
	}
});

Pubkeys.method('echo', {
	schema: {
		msg: { type: String, required: true }
	},
	handler: function (options, callback) {
		callback(null, options.msg);
	}
});

function addTxToChain(data, e) {
	var lastEntry = data.chain[data.chain.length-1];
	var prevHash = new Buffer(lastEntry.chainHash, 'base64');
	var chainHash = Util.sha256(prevHash.concat(e.tx.hash));
	var chainTx = {
		hash: e.tx.hash.toString('base64'),
		chainHash: chainHash.toString('base64'),
		height: e.block.height
	};
	data.chain.push(chainTx);

	data.emit('txAdd', {data: data, tx: e.tx, chainTx: chainTx, block: e.block});
};

function revokeTxFromChain(data, e) {
	// TODO: Implement
};

Pubkeys.method('register', {
	schema: {
		keys: { type: String }
	},
	handler: function (params, callback) {
		var handle = Util.sha256(params.keys).toString('base64');

		var storage = this.node.getStorage();
		var accounting = this.node.getAccounting();

		// Validate keys
		var keys = params.keys.split(',');
		var pubKeyHashes = [];
		for (var i = 0; i < keys.length; i++) {
			// Trim whitespace
			var key = keys[i].replace(/^\s+|\s+$/g, '');

			// Ignore empty keys
			if (!key.length) continue;

			// Convert Bitcoin address to pubkey hash
			var pubKeyHash = Util.addressToPubKeyHash(keys[i]);
			if (!pubKeyHash) {
				callback({
					type: "InvalidKeys",
					message: "This is not a valid Bitcoin address: '"+keys[i]+"'"
				});
				return;
			}
			pubKeyHashes.push(pubKeyHash.toString('base64'));
		}

		// Make sure we have at least one key
		if (!pubKeyHashes.length) {
			callback({
				type: "NoKeys",
				message: "Client did not provide any keys to register."
			});
			return;
		}

		function getDataForKeys(storage, pubKeyHashes, callback) {
			for (var i = 0; i < pubKeyHashes.length; i++) {
				var pubKeyHash = pubKeyHashes[i];
			}

			storage.Account.find({pubKeyHash: {"$in": pubKeyHashes}}, function (err, accounts) {
				if (err) {
					callback(err);
					return;
				}

				var data = new PubkeysData();

				data.chain = [];
				data.accounts = accounts;

				var txsArray = [];
				var accIndex = {};
				accounts.forEach(function (account) {
					// Set up events for new transactions
					var pubKeyHash = account.pubKeyHash.toString('base64');
					accounting.addListener('txAdd:'+pubKeyHash, addTxToChain.bind(global, data));
					accounting.addListener('txRevoke:'+pubKeyHash, revokeTxFromChain.bind(global, data));

					// Create big array with all transaction references
					txsArray = txsArray.concat(account.txs);

					accIndex[pubKeyHash] = account;
				});
				// Sort transactions by height, then index
				txsArray.sort(function (a,b) {
					if (a.height == b.height) {
						return a.index - b.index;
					} else {
						return a.height - b.height;
					}
				});

				// Create mock account objects for the accounts that
				// aren't in the database yet.
				pubKeyHashes.forEach(function (pubKeyHash) {
					if (!accIndex[pubKeyHash]) {
						accounts.push(new storage.Account({
							pubKeyHash: pubKeyHash,
							txs: []
						}));
					}
				});

				// Create a chain with only unique values
				var curHash, lastHast, chainHash;
				for (var i = 0; i < txsArray.length; i++) {
					curHash = new Buffer(txsArray[i].tx, 'base64');
					// Add first tx
					if (i == 0) {
						chainHash = curHash;
						data.chain.push({
							hash: curHash.toString('base64'),
							chainHash: chainHash.toString('base64'),
							height: txsArray[i].height,
							index: txsArray[i].n
						});
						// Add only unique txs
						// (we only need to check against the last one as they are sorted)
					} else if (lastHash.compare(curHash) != 0) {
						chainHash = Util.sha256(chainHash.concat(curHash));
						data.chain.push({
							hash: txsArray[i].tx,
							chainHash: chainHash.toString('base64'),
							height: txsArray[i].height
						});
					} else {
						continue;
					}
					lastHash = curHash;
				}

				callback(null, data);
			});
		};

		if ("undefined" == typeof PubkeysCache[handle]) {
			// Set the handle to a function that waits for the result, then triggers
			cache[handle] = function (callback) {
				cache.once(handle, callback);
			};
			getDataForKeys(storage, pubKeyHashes, function (err, data) {
				// Now that the result is ready, the handle should be a function
				// that calls the provided callback immediately
				cache[handle] = function (callback) {
					callback(err, data);
				};

				// Call any callbacks that are waiting for this data
				cache.emit(handle, err, data);
			});
		}

		// We don't wait for anything, we just return with the handle, the caching is
		// taking place in the background while we wait for the client's next request
		callback(null, {
			handle: handle
		});
	}
});

var MAX_PER_REQUEST = 100;

Pubkeys.method('gettxs', {
	schema: {
		handle: { type: String, required: true }
	},
	handler: function (params, callback) {
		var self = this;

		var handle = params.handle;
		var txLocator = params.txLocator ? params.txLocator : [];

		var storage = this.node.getStorage();
		var blockChain = this.node.getBlockChain();

		function sendResult(err, data) {
			if (err) {
				err.type = 'ServerError';
				callback(err);
				return;
			}

			var top = data.chain.length ?
				data.chain[data.chain.length-1].chainHash :
				Util.NULL_HASH;

			var start = 0;
			loop:
			if (txLocator.length) {
				for (var i = data.chain.length-1; i >= 0; i--) {
					for (var j = 0; j < txLocator.length; j++) {
						if (data.chain[i].hash.compare(txLocator[j]) == 0) {
							start = i;
							break loop;
						}
					}
				}
			}

			var txs = data.chain.slice(i, MAX_PER_REQUEST);

			var txsHashes = txs.map(function (val) {
				return val.hash;
			});
			storage.Transaction.find({hash: {"$in": txsHashes}}, function (err, data) {
				if (err) {
					err.type = 'ServerError';
					callback(err);
					return;
				}

				var txIndex = {};
				data.forEach(function (tx) {
					txIndex[tx.hash.toString('base64')] = tx.toObject();
				});

				var blockList = [];
				txs.forEach(function (val) {
					var dbObj = txIndex[val.hash];

					var blockHash = dbObj.block.toString('base64');
					if (blockList.indexOf(blockHash) == -1) {
						blockList.push(blockHash);
					}
				});

				storage.Block.find({hash: {$in: blockList}}, function (err, blocks) {
					if (err) {
						callback(err);
						return;
					}

					var blockIndex = {};
					blocks.forEach(function (block) {
						blockIndex[block.hash.toString('base64')] = block;
					});

					txs = txs.map(function (chainTx) {
						var dbObj = txIndex[chainTx.hash];
						var block = blockIndex[dbObj.block.toString('base64')];

						var outObj = self.createOutTx(dbObj, chainTx, block);
						return outObj;
					});

					callback(null, {
						top: top.toString('base64'),
						txs: txs,
						height: +blockChain.getTopBlock().height
					});
				});
			});
		};

		if ("undefined" == typeof cache[handle]) {
			callback({
				type: 'UnknownHandle',
				message: 'Please use pubkeys/register to announce this handle first.'
			});
			return;
		} else {
			cache[handle](sendResult);
		}
	}
});

Pubkeys.method('getunconfirmedtxs', {
	schema: {
		handle: { type: String, required: true }
	},
	handler: function (params, callback) {
		var self = this;

		var handle = params.handle;
		var txLocator = params.txLocator ? params.txLocator : [];

		var txStore = this.node.getTxStore();

		function sendResult(err, data) {
			if (err) {
				err.type = 'ServerError';
				callback(err);
				return;
			}

			var accHashes = data.accounts.map(function (account) {
				return account.pubKeyHash.toString('base64');
			});

			txStore.findByAccount(accHashes, function (err, txs) {
				txs = txs.map(function (tx) {
					return self.createOutTx(tx);
				});

				callback(null, {txs: txs});
			});
		};

		if ("undefined" == typeof cache[handle]) {
			callback({
				type: 'UnknownHandle',
				message: 'Please use pubkeys/register to announce this handle first.'
			});
			return;
		} else {
			cache[handle](sendResult);
		}
	}
});

Pubkeys.method('getinfo', {
	schema: {
		handle: { type: String, required: true }
	},
	handler: function (params, callback) {
		var handle = params.handle;

		function sendResult(err, data) {
			if (err) {
				err.type = 'ServerError';
				callback(err);
				return;
			}
			callback(null, data);
		};

		if ("undefined" == typeof cache[handle]) {
			callback({
				type: 'UnknownHandle',
				message: 'Please use pubkeys/register to announce this handle first.'
			});
			return;
		} else {
			cache[handle](sendResult);
		}
	}
});

Pubkeys.prototype.createOutTx = function (dbObj, chainTx, block) {
	var outObj = {
		version: +dbObj.version,
		lock_time: +dbObj.lock_time,
		hash: dbObj.hash.toString('base64'),
		ins: [],
		outs: []
	};

	dbObj.ins.forEach(function (dbTxin) {
		var outTxin = {};
		outTxin.outpoint = {
			hash: dbTxin.outpoint.hash.toString('base64'),
			index: +dbTxin.outpoint.index
		};
		outTxin.script = dbTxin.script.toString('base64');
		outTxin.sequence = +dbTxin.sequence;
		outObj.ins.push(outTxin);
	});
	dbObj.outs.forEach(function (dbTxout) {
		var outTxout = {};
		outTxout.value = Util.valueToBigInt(new Buffer(dbTxout.value, 'base64')).toString();
		outTxout.script = dbTxout.script.toString('base64');
		outObj.outs.push(outTxout);
	});

	// chainTx and blockHash can be null if the transaction is unconfirmed
	if (chainTx) {
		outObj.chainHash = chainTx.chainHash;
		outObj.index = +chainTx.index;
	}

	if (block) {
		outObj.block = {
			hash: block.getHash().toString('base64'),
			height: +block.height
		};
		outObj.timestamp = block.timestamp;
	} else if (dbObj.first_seen) {
		outObj.timestamp = Math.floor(dbObj.first_seen.getTime()/1000);
	}

	return outObj;
};

/*
exports.node = null;

exports.echo = function(options, callback){
  callback(null, options.msg);
};
exports.echo.description = "this is the echo method, it echos back your msg";
exports.echo.schema = {
  msg: { 
    type: 'string',
    optional: false 
  }
};

exports.ping = function(options, callback){
  setTimeout(function(){
    callback(null, 'pong');
  }, 2000);
}
exports.ping.description = "this is the ping method, it pongs back after a 2 second delay";

exports.register = function (options, callback) {
	console.log(this.node);
	callback(null, '');
};
*/
