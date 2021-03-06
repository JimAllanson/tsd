/*
 * imported from typescript-xm package
 *
 * Bart van der Schoor
 * https://github.com/Bartvds/typescript-xm
 * License: MIT - 2013
 * */

/// <reference path="StyledOut.ts" />

module xm {
	'use strict';

	var util = require('util');

	export var consoleOut:xm.StyledOut = new xm.StyledOut();
	// will be set below
	export var log:xm.Logger;

	//TODO consider merging Logger for StyledOut
	//TODO find pattern to use sub-loggers that auto-update when .out changes) (o.a xm.EventLog need this)
	export interface Logger {
		(...args:any[]):void;
		ok(...args:any[]):void;
		log(...args:any[]):void;
		warn(...args:any[]):void;
		error(...args:any[]):void;
		debug(...args:any[]):void;
		status(...args:any[]):void;
		//TODO flip depth/label order
		inspect(value:any, depth?:number, label?:string):void;
		json(value:any):void;
		enabled:boolean;
		out:xm.StyledOut;
	}

	function writeMulti(logger:Logger, args:any[]):void {
		var ret:string[] = [];
		for (var i = 0, ii = args.length; i < ii; i++) {
			var value:any = args[i];
			if (value && typeof value === 'object') {
				ret.push(util.inspect(value, <any>{showHidden: false, depth: 8}));
			}
			else {
				value = String(value);
				if (value.length === 0) {
					continue;
				}
				ret.push(value);
			}
		}
		if (ret.length > 0) {
			logger.out.line(ret.join('; '));
		}
	}

	//TODO should be createLogger as there is no storage
	export function getLogger(label?:string):xm.Logger {

		label = arguments.length > 0 ? (String(label) + ' ') : '';

		var precall = function () {
			//not working with promises
			/*if (logger.callSite) {
			 xm.stack.getStackLines(0, 0, true).map((line:xm.stack.Stackline) => {
			 logger.out.span('-# ').line(line.link);
			 });
			 }*/
		};

		var plain = function (...args:any[]) {
			if (logger.enabled) {
				precall();
				writeMulti(logger, args);
			}
		};

		var doLog = function (logger:Logger, args:any[]) {
			if (args.length > 0) {
				writeMulti(logger, args);
			}
		};

		var logger:Logger = <Logger>(function (...args:any[]) {
			if (logger.enabled) {
				plain.apply(null, args);
			}
		});
		logger.out = consoleOut;
		logger.enabled = true;

		// alias
		logger.log = plain;

		logger.ok = function (...args:any[]) {
			if (logger.enabled) {
				precall();
				logger.out.span('-> ').success(label + 'ok ');
				doLog(logger, args);
			}
		};
		logger.warn = function (...args:any[]) {
			if (logger.enabled) {
				precall();
				logger.out.span('-> ').warning(label + 'warning ');
				doLog(logger, args);
			}
		};
		logger.error = function (...args:any[]) {
			if (logger.enabled) {
				precall();
				logger.out.span('-> ').error(label + 'error ');
				doLog(logger, args);
			}
		};
		logger.debug = function (...args:any[]) {
			if (logger.enabled) {
				precall();
				logger.out.span('-> ').accent(label + 'debug ');
				doLog(logger, args);
			}
		};
		logger.status = function (...args:any[]) {
			if (logger.enabled) {
				precall();
				logger.out.accent('-> ').span(label + ' ');
				doLog(logger, args);
			}
		};
		logger.inspect = function (value:any, depth:number = 3, label?:string) {
			if (logger.enabled) {
				precall();
				logger.out.span('-> ').cond(arguments.length > 2, label + ' ').inspect(value, depth);
			}
		};
		logger.json = function (value:any, label?:string) {
			if (logger.enabled) {
				precall();
				logger.out.span('-> ').cond(arguments.length > 2, label + ' ').block(JSON.stringify(value, null, 3));
			}
		};

		return logger;
	}

	xm.log = getLogger();
	Object.defineProperty(xm, 'log', {writable: false});
}
