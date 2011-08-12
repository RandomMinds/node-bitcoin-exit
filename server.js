var bitcoin = require('bitcoin-p2p');
var express = require('express');
var Pubkeys = require('./pubkeys').Pubkeys;
var Tx = require('./tx').Tx;
var Block = require('./block').Block;
var RealtimeAPI = require('./realtime').API;

var createNode = require('../node-bitcoin-p2p/daemon/init').createNode;

var node = createNode({ welcome: true });
node.start();

var app = express.createServer();


// Configuration

app.configure(function(){
	app.set('views', __dirname + '/views');
	app.set('view engine', 'ejs');
	app.use(express.bodyParser());
	app.use(express.methodOverride());
	app.use(app.router);
	app.use(express.static(__dirname + '/public'));
});

app.configure('development', function(){
	app.use(express.errorHandler({ dumpExceptions: true, showStack: true })); 
});

app.configure('production', function(){
	app.use(express.errorHandler());
});

var pubkeysModule = new Pubkeys({
	node: node
});
pubkeysModule.attach(app, '/pubkeys/');

var txModule = new Tx({
	node: node
});
txModule.attach(app, '/tx/');

var blockModule = new Block({
	node: node
});
blockModule.attach(app, '/block/');

app.listen(3125);

var io = require('socket.io').listen(app);
var realtimeApi = new RealtimeAPI(io, node, pubkeysModule, txModule, blockModule);

