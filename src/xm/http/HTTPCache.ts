/*
 * imported from typescript-xm package
 *
 * Bart van der Schoor
 * https://github.com/Bartvds/typescript-xm
 * License: MIT - 2013
 * */

/// <reference path="../../_ref.d.ts" />
/// <reference path="../object.ts" />
/// <reference path="../promise.ts" />
/// <reference path="../EventLog.ts" />
/// <reference path="../hash.ts" />
/// <reference path="../typeOf.ts" />
/// <reference path="../file.ts" />
/// <reference path="../Koder.ts" />
/// <reference path="../data/PackageJSON.ts" />
/// <reference path="CacheStreamLoader.ts" />
/// <reference path="CacheMode.ts" />
/// <reference path="CacheObject.ts" />

module xm {
	'use strict';

	var Q = require('q');
	var fs = require('fs');
	var path = require('path');
	var FS:typeof QioFS = require('q-io/fs');
	var HTTP:typeof QioHTTP = require('q-io/http');

	require('date-utils');

	// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

	export module http {

		export interface CacheManage {
			lastSweep:string;
		}

		// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

		export class HTTPCache {

			static get_object = 'get_object';
			static drop_job = 'drop_job';

			storeDir:string;
			opts:CacheOpts;
			track:xm.EventLog;

			infoKoder:IContentKoder<CacheInfo>;
			infoSchema:any;

			// linger & clear
			jobTimeout:number = 1000;

			private jobs = new Map<string, CacheStreamLoader>();
			private remove = new Map<string, NodeTimer>();


			private _init:Q.Promise<void>;

			private manageFile:string;
			private manageKoder:IContentKoder<CacheManage>;
			private manageSchema:any;
			private cacheSweepLast:Date;

			constructor(storeDir:string, opts?:CacheOpts) {
				xm.assertVar(storeDir, 'string', 'storeDir');
				xm.assertVar(opts, CacheOpts, 'opts', true);

				this.storeDir = storeDir;
				this.opts = (opts || new CacheOpts());

				this.manageFile = path.join(this.storeDir, '_info.json');

				this.track = new xm.EventLog('http_cache', 'HTTPCache');
				this.track.unmuteActions([xm.Level.reject, xm.Level.notify]);
			}

			getObject(request:CacheRequest):Q.Promise<CacheObject> {
				xm.assertVar(request, xm.http.CacheRequest, 'request');
				xm.assert(request.locked, 'request must be lock()-ed {a}', request.url);

				var d:Q.Deferred<CacheObject> = Q.defer();
				this.track.promise(d.promise, HTTPCache.get_object);

				this.init().then(() => {
					var job:CacheStreamLoader;
					if (this.jobs.has(request.key)) {
						job = this.jobs.get(request.key);
						this.track.share(HTTPCache.get_object, request.url);

						return job.getObject().progress(d.notify).then(d.resolve);
					}
					else {
						job = new CacheStreamLoader(this, request);
						this.jobs.set(request.key, job);

						job.track.logEnabled = this.track.logEnabled;
						this.track.start(HTTPCache.get_object, request.url);

						return job.getObject().progress(d.notify).then((value:any) => {
							this.track.complete(HTTPCache.get_object);
							d.resolve(value);
						});
					}
				}).fail(d.reject).then(() => {
					// housekeeping
					this.scheduleRelease(request.key);

					return this.checkCleanCache();
				}).done();

				return d.promise;
			}

			private scheduleRelease(key:string):void {
				if (this.jobs.has(key)) {
					if (this.remove.has(key)) {
						clearTimeout(this.remove.get(key));
					}
					this.remove.set(key, setTimeout(() => {
						this.track.event(HTTPCache.drop_job, 'droppped ' + key, this.jobs.get(key));

						this.jobs.delete(key);

					}, this.jobTimeout));
				}
			}

			private init():Q.Promise<void> {
				if (this._init) {
					this.track.skip('init');
					return this._init;
				}
				var d:Q.Deferred<void> = Q.defer();
				this._init = d.promise;
				this.track.promise(d.promise, 'init');

				var baseDir;
				var schemaDir;

				// first create directory
				FS.exists(this.storeDir).then((exists:boolean) => {
					if (!exists) {
						this.track.event('dir_create', this.storeDir);
						return xm.file.mkdirCheckQ(this.storeDir, true, true);
					}

					return FS.isDirectory(this.storeDir).then((isDir:boolean) => {
						if (!isDir) {
							this.track.error('dir_error', this.storeDir);
							throw new Error('is not a directory: ' + this.storeDir);
						}
						this.track.event('dir_exists', this.storeDir);
					});
				}).then(() => {					// find module directory
					return file.findup(path.dirname((module).filename), 'package.json').then((src:string) => {
						baseDir = path.dirname(src);
						schemaDir = path.join(baseDir, 'schema');
					});
				}).then(() => {
					// load info schema
					var p = path.join(schemaDir, 'cache-v1.json');
					return xm.file.readJSONPromise(p).then((infoSchema:string) => {
						xm.assertVar(infoSchema, 'object', 'infoSchema');
						this.infoSchema = infoSchema;
						this.infoKoder = new JSONKoder<CacheInfo>(this.infoSchema);
					});
				}).then(() => {
					var p = path.join(schemaDir, 'manage-v1.json');
					return xm.file.readJSONPromise(p).then((manageSchema:string) => {
						xm.assertVar(manageSchema, 'object', 'manageSchema');
						this.manageSchema = manageSchema;
						this.manageKoder = new JSONKoder<CacheManage>(this.manageSchema);
					});
				}).done(() => {
					d.resolve();
				}, d.reject);

				return d.promise;
			}

			checkCleanCache():Q.Promise<void> {
				var d:Q.Deferred<void> = Q.defer();
				if (!this._init || !this.opts.allowClean || !xm.isNumber(this.opts.cacheCleanInterval)) {
					d.resolve();
					return d.promise;
				}
				if (this.cacheSweepLast && this.cacheSweepLast.getTime() > Date.now() - this.opts.cacheCleanInterval) {
					this.track.skip('cache_clean', this.storeDir);
					d.resolve();
					return d.promise;
				}

				this.track.event('cache_clean', this.storeDir);

				var manageInfo;

				FS.exists(this.manageFile).then((exists:boolean) => {
					if (!exists) {
						return;
					}
					return FS.read(this.manageFile).then((buffer:NodeBuffer) => {
						return this.manageKoder.decode(buffer).then((info:CacheManage) => {
							manageInfo = info;
						}).fail((err) => {
							this.track.logger.warn('removing bad manageFile: ' + this.manageFile);
							return xm.file.removeFile(this.manageFile);
						});
					});
				}).then(() => {
					if (manageInfo) {
						var date = new Date(manageInfo.lastSweep);
						if (date.getTime() > Date.now() - this.opts.cacheCleanInterval) {
							// fine, keep it
							return;
						}
					}
					return this.cleanupCacheAge(this.opts.cacheCleanInterval).then(() => {
						this.cacheSweepLast = new Date();
						if (!manageInfo) {
							manageInfo = {
								lastSweep: this.cacheSweepLast.toISOString()
							};
						}
						else {
							manageInfo.lastSweep = this.cacheSweepLast.toISOString();
						}
						return this.manageKoder.encode(manageInfo).then((buffer:NodeBuffer) => {
							return FS.write(this.manageFile, buffer);
						});
					});
				}).done(() => {
					d.resolve();
				}, d.reject);

				return d.promise;
			}

			cleanupCacheAge(maxAge:number):Q.Promise<void> {
				xm.assertVar(maxAge, 'number', 'maxAge');

				var d:Q.Deferred<void> = Q.defer();
				this.track.promise(d.promise, 'clean_cache_age');

				this.init().then(() => {
					var limit = Date.now() - maxAge;

					return FS.listTree(this.storeDir, (src:string, stat:QioFS.Stats) => {
						if (stat.node.isFile()) {
							var ext = path.extname(src);
							if (ext !== '.json') {
								return false;
							}
							var name = path.basename(src, ext);
							if (!xm.isSha(name)) {
								return false;
							}
							if (stat.node.atime.getTime() > limit) {
								return false;
							}
							//kill it
							return true;
						}
						return false;
					}).then((tree:string[]) => {
						return Q.all(tree.reduce((memo:any[], src:string) => {
							memo.push(xm.file.removeFile(src));
							memo.push(xm.file.removeFile(src.replace(/\.json$/, '.raw')));
							return memo;
						}, []));
					});
				}).done(() => {
					d.resolve();
				}, d.reject);

				return d.promise;
			}


			private getDir(key:string):boolean {
				return path.join(this.storeDir, key.charAt(0), key.charAt(1), key);
			}

			set verbose(verbose:boolean) {
				this.track.logEnabled = verbose;
			}
		}
	}
}
