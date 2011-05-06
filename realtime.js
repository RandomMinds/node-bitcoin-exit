var RealtimeAPI = exports.API = function (socket, node, pubkeysModule, txModule, blockModule) {
	this.socket = socket;
	this.node = node;
	this.pubkeysModule = pubkeysModule;
	this.txModule = txModule;
	this.blockModule = blockModule;

	socket.on('connection', (function (client) {
		client.on('message', (function (data) {
			data = JSON.parse(data);
			console.log("<<<", data);

			var defaultCallback = (function (err, result) {
				if (err) this.sendError(client, err, data.id);
				else this.sendResult(client, result, data.id);
			}).bind(this);

			switch (data.method) {
			case "pubkeysRegister":
			case "pubkeysListen":
			case "pubkeysUnconfirmed":
				this[data.method](client, data.params[0], defaultCallback);
				break;
			default:
				this.sendError(client, "Unknown method '"+data.method+"'", data.id);
			}
		}).bind(this));
	}).bind(this));

	var blockChain = node.getBlockChain();
	blockChain.addListener('blockAdd', (function (e) {
		this.sendBroadcast(socket, "blockAdd", {
			top: e.block.hash.toString('base64'),
			height: +e.block.height
		});
	}).bind(this));
};

RealtimeAPI.prototype.pubkeysRegister = function (client, params, callback) {
	this.pubkeysModule.register(params, callback);
};

RealtimeAPI.prototype.pubkeysListen = function (client, params, callback) {
	var self = this;
	var acc = this.node.getAccounting();
	var txs = this.node.getTxStore();

	if (client.pubkeysListening) {
		console.log("existing client");
		// Client is already listening to events
		self.pubkeysModule.gettxs(params, callback);
	} else {
		console.log("new client");
		// This is the first time the client calls
		client.pubkeysListening = true;

		self.pubkeysModule.getinfo(params, function (err, data) {
			if (err) {
				callback(err);
				return;
			}

			self.pubkeysModule.gettxs(params, callback);

			var handleTxAdd = function (e) {
				self.handleTxAdd(client, e);
			};
			var handleTxRevoke = function (e) {
				self.handleTxRevoke(client, e);
			};
			var handleTxNotify = function (e) {
				self.handleTxNotify(client, data, e);
			};
			var handleTxCancel = function (e) {
				self.handleTxCancel(client, data, e);
			};

			// Add listeners for transactions affecting these accounts
			data.addListener('txAdd', handleTxAdd);
			data.addListener('txRevoke', handleTxRevoke);
			data.accounts.forEach(function (account) {
				var pubKeyHash = account.pubKeyHash.toString('base64');
				txs.addListener('txNotify:'+pubKeyHash, handleTxNotify);
				txs.addListener('txCancel:'+pubKeyHash, handleTxCancel);
			});

			// Remove those listeners when the user disconnects
			client.on('disconnect', function () {
				data.removeListener('txAdd', handleTxAdd);
				data.accounts.forEach(function (account) {
					var pubKeyHash = account.pubKeyHash.toString('base64');
					txs.removeListener('txNotify:'+pubKeyHash, handleTxNotify);
					txs.removeListener('txCancel:'+pubKeyHash, handleTxCancel);
				});
			});
		});
	}
};

RealtimeAPI.prototype.pubkeysUnconfirmed = function (client, params, callback) {
	this.pubkeysModule.getunconfirmedtxs(params, callback);
};

RealtimeAPI.prototype.handleTxAdd = function (client, e) {
	var tx = this.pubkeysModule.createOutTx(e.tx, e.chainTx, e.block);
	this.sendRequest(client, 'txAdd', {tx: tx});
};

RealtimeAPI.prototype.handleTxRevoke = function (client, e) {
	this.sendRequest(client, 'txRevoke', {hash: e.tx.getHash().toString('base64')});
};

RealtimeAPI.prototype.handleTxNotify = function (client, data, e) {
	var tx = this.pubkeysModule.createOutTx(e.tx);
	this.sendRequest(client, 'txNotify', {tx: tx});
};

RealtimeAPI.prototype.handleTxCancel = function (client, data, e) {
	this.sendRequest(client, 'txCancel', {hash: e.tx.getHash().toString('base64')});
};

RealtimeAPI.prototype.sendError = function (client, msg, id) {
	client.send(JSON.stringify({
		"result": null,
		"error": msg,
		"id": id
	}));
};
RealtimeAPI.prototype.sendResult = function (client, result, id) {
	var msg = {
		"result": result,
		"error": null,
		"id": id
	};
	console.log(">>>", msg);
	client.send(JSON.stringify(msg));
};
RealtimeAPI.prototype.sendRequest = function (client, method, paramObj, callback) {
	var msg = {
		"method": method,
		"params": [paramObj],
		"id": unique++
	};

	// If there is no callback, use JSON-RPC notification format (id = null)
	if (callback) {
		// TODO: Implement RPC invocations with response
	} else {
		msg.id = null;
	}

	console.log('<<<', msg);
	client.send(JSON.stringify(msg));
};
var unique = 1;
RealtimeAPI.prototype.sendBroadcast = function (socket, method, paramObj, callback) {
	var msg = {
		"method": method,
		"params": [paramObj],
		"id": unique++
	};

	// If there is no callback, use JSON-RPC notification format (id = null)
	if (callback) {
		// TODO: Implement broadcast invocations with response
	} else {
		msg.id = null;
	}

	console.log('<<< (BC)', msg);
	socket.broadcast(JSON.stringify(msg));
};
