var sys = require('sys');
require('buffertools');
var Module = require('./webservice').Module;
var bitcoin = require('bitcoin-p2p');
var Util = bitcoin.Util;

var Tx = exports.Tx = Module.define({
	title: "Welcome to your webservice!",
	name: "transaction service",
	version: "0.1.0",
	construct: function (params) {
		this.node = params.node;
	},
	schema: {
		'node': { type: bitcoin.Node, required: true }
	}
});

Tx.method('send', {
	schema: {
		tx: { type: String, required: true }
	},
	handler: function (params, callback) {
		// TODO: Call handleTx as if this transaction arrived with the network (or something like that :P)
		var txBuf = new Buffer(params.tx.toString(), 'base64');
		var message = bitcoin.Connection.parseMessage("tx", txBuf);
		delete message.command;
		var Transaction = this.node.getStorage().Transaction;
		var tx = new Transaction(message);
		this.node.sendTx(tx, function (err) {
			if (err) {
				callback(err);
				return;
			}
			callback(null, {success: true});
		});
	}
});
