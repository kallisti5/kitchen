/*
 * Copyright 2015 Haiku, Inc. All rights reserved.
 * Distributed under the terms of the MIT License.
 *
 * Authors:
 *		Augustin Cavalier <waddlesplash>
 */

var log = require('debug')('kitchen:builders'), fs = require('fs'),
	crypto = require('crypto');

if (!fs.existsSync('data/builders.json')) {
	log('FATAL: no builders configuration file! set one up using kitchen.js.');
	process.exit(1);
}

module.exports = function () {
	this.builders = JSON.parse(fs.readFileSync('data/builders.json',
		{encoding: 'UTF-8'}));

	this._builderAuthenticated = function (sock, name) {
		function sendJSON(object) {
			sock.write(JSON.stringify(object) + '\n');
		}

		this.builders[name].ip = sock.remoteAddress;
		sendJSON({'what': 'getCores'});

		var thisThis = this, dataBuf = '', data;
		sock.on('data', function (dat) {
			dataBuf += dat.toString();
			data = dataBuf.split('\n');
			dataBuf = data[data.length - 1];
			delete data[data.length - 1];

			for (var i in data) {
				var msg = JSON.parse(data[i]);
				switch (msg.what) {
				case 'coreCount':
					thisThis.builders[name].cores = msg.count;
					break;

				default:
					log("WARN: couldn't understand this message from '%s': %s",
						name, msg);
					break;
				}
			}
		});
		sock.on('close', function () {
			log("builder '%s' disconnected", name);
			delete thisThis.builders[name].ip;
			delete thisThis.builders[name].hrev;
			delete thisThis.builders[name].cores;
			delete thisThis.builders[name].architecture;
			delete thisThis.builders[name].flavor;
		});
	};

	var options = {
		key: fs.readFileSync('data/server.key'),
		cert: fs.readFileSync('data/server.crt')
	};
	var thisThis = this;
	require('tls').createServer(options, function (sock) {
		log('socket opened from %s', sock.remoteAddress);
		var msg = '';
		sock.on('data', function (data) {
			msg += data.toString();
			if (msg.indexOf('\n') < 0)
				return;

			msg = JSON.parse(msg);
			if (msg.what != 'auth') {
				log("AUTHFAIL: %s's first message is not 'auth'!",
					sock.remoteAddress);
				sock.destroy();
				return;
			}
			if (!(msg.name in thisThis.builders)) {
				log("AUTHFAIL: builder's name is '%s' but no known builders " +
					"with that name.", msg.name);
				sock.destroy();
				return;
			}

			// process key
			var hash = thisThis.builders[msg.name].keyHash.substr(0, 44),
				salt = thisThis.builders[msg.name].keyHash.substr(44),
				sha256sum = crypto.createHash('SHA256');
			sha256sum.update(msg.key + salt);
			var hashedKey = sha256sum.digest('base64');
			if (hashedKey != hash) {
				log("AUTHFAIL: hash for key of builder '%s' is '%s', " +
					"but '%s' was expected.", msg.name, hashedKey, hash);
				sock.destroy();
				return;
			}
			log("builder '%s' successfully authenticated from IP %s" +
				msg.name, sock.remoteAddress);
			sock.removeAllListeners('data');
			thisThis._builderAuthenticated(sock, msg.name);
		});
		sock.write('\n'); // indicates to the builder we're ready
	}).listen(42458 /* HAIKU */);
};