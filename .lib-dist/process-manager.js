"use strict";Object.defineProperty(exports, "__esModule", {value: true});/**
 * Process Manager
 * Pokemon Showdown - http://pokemonshowdown.com/
 *
 * This file abstract out multiprocess logic involved in several tasks.
 *
 * Child processes can be queried.
 *
 * @license MIT
 */

var _child_process = require('child_process'); var child_process = _child_process;
var _path = require('path'); var path = _path;
var _streams = require('./streams'); var Streams = _streams;

const ROOT_DIR = path.resolve(__dirname, '..');

 const processManagers = []; exports.processManagers = processManagers;
 const disabled = false; exports.disabled = disabled;

class SubprocessStream extends Streams.ObjectReadWriteStream {
	constructor( process,  taskId) {
		super();this.process = process;this.taskId = taskId;;
		this.process = process;
		this.taskId = taskId;
		this.process.send(`${taskId}\nNEW`);
	}
	_write(message) {
		if (!this.process.connected) return;
		this.process.send(`${this.taskId}\nWRITE\n${message}`);
		// responses are handled in ProcessWrapper
	}
	_destroy() {
		if (!this.process.connected) return;
		this.process.send(`${this.taskId}\nDESTROY`);
	}
}






/** Wraps the process object in the PARENT process. */
 class QueryProcessWrapper {
	
	
	
	
	

	constructor(file) {
		this.process = child_process.fork(file, [], {cwd: ROOT_DIR});
		this.taskId = 0;
		this.pendingTasks = new Map();
		this.pendingRelease = null;
		this.resolveRelease = null;

		this.process.on('message', (message) => {
			const nlLoc = message.indexOf('\n');
			if (nlLoc <= 0) throw new Error(`Invalid response ${message}`);
			if (message.slice(0, nlLoc) === 'THROW') {
				const error = new Error();
				error.stack = message.slice(nlLoc + 1);
				throw error;
			}

			const taskId = parseInt(message.slice(0, nlLoc), 10);
			const resolve = this.pendingTasks.get(taskId);
			if (!resolve) throw new Error(`Invalid taskId ${message.slice(0, nlLoc)}`);
			this.pendingTasks.delete(taskId);
			resolve(JSON.parse(message.slice(nlLoc + 1)));

			if (this.resolveRelease && !this.load) this.destroy();
		});
		this.process.on('disconnect', () => {
			this.destroy();
		});
	}

	get load() {
		return this.pendingTasks.size;
	}

	query(input) {
		this.taskId++;
		const taskId = this.taskId;
		this.process.send(`${taskId}\n${JSON.stringify(input)}`);
		return new Promise(resolve => {
			this.pendingTasks.set(taskId, resolve);
		});
	}

	release() {
		if (this.pendingRelease) return this.pendingRelease;
		if (!this.load) {
			this.destroy();
		} else {
			this.pendingRelease = new Promise(resolve => {
				this.resolveRelease = resolve;
			});
		}
		return this.pendingRelease ;
	}

	destroy() {
		if (this.pendingRelease && !this.resolveRelease) {
			// already destroyed
			return;
		}
		this.process.disconnect();
		for (const resolver of this.pendingTasks.values()) {
			// maybe we should track reject functions too...
			resolver('');
		}
		this.pendingTasks.clear();
		if (this.resolveRelease) {
			this.resolveRelease();
			this.resolveRelease = null;
		} else if (!this.pendingRelease) {
			this.pendingRelease = Promise.resolve();
		}
	}
} exports.QueryProcessWrapper = QueryProcessWrapper;

/** Wraps the process object in the PARENT process. */
 class StreamProcessWrapper {
	
	
	
	
	

	constructor(file) {
		this.process = child_process.fork(file, [], {cwd: ROOT_DIR});
		this.taskId = 0;
		this.activeStreams = new Map();
		this.pendingRelease = null;
		this.resolveRelease = null;

		this.process.on('message', (message) => {
			let nlLoc = message.indexOf('\n');
			if (nlLoc <= 0) throw new Error(`Invalid response ${message}`);
			if (message.slice(0, nlLoc) === 'THROW') {
				const error = new Error();
				error.stack = message.slice(nlLoc + 1);
				throw error;
			}

			const taskId = parseInt(message.slice(0, nlLoc), 10);
			const stream = this.activeStreams.get(taskId);
			if (!stream) throw new Error(`Invalid taskId ${message.slice(0, nlLoc)}`);

			message = message.slice(nlLoc + 1);
			nlLoc = message.indexOf('\n');
			if (nlLoc < 0) nlLoc = message.length;
			const messageType = message.slice(0, nlLoc);
			message = message.slice(nlLoc + 1);

			if (messageType === 'END') {
				const end = stream.end();
				this.deleteStream(taskId);
				return end;
			} else if (messageType === 'PUSH') {
				stream.push(message);
			} else if (messageType === 'THROW') {
				const error = new Error();
				error.stack = message;
				stream.pushError(error);
			} else {
				throw new Error(`Unrecognized messageType ${messageType}`);
			}
		});
		this.process.on('disconnect', () => {
			this.destroy();
		});
	}

	deleteStream(taskId) {
		this.activeStreams.delete(taskId);
		// try to release
		if (this.resolveRelease && !this.load) this.destroy();
	}

	get load() {
		return this.activeStreams.size;
	}

	createStream() {
		this.taskId++;
		const taskId = this.taskId;
		const stream = new SubprocessStream(this.process, taskId);
		this.activeStreams.set(taskId, stream);
		return stream;
	}

	release() {
		if (this.pendingRelease) return this.pendingRelease;
		if (!this.load) {
			this.destroy();
		} else {
			this.pendingRelease = new Promise(resolve => {
				this.resolveRelease = resolve;
			});
		}
		return this.pendingRelease ;
	}

	destroy() {
		if (this.pendingRelease && !this.resolveRelease) {
			// already destroyed
			return;
		}
		this.process.disconnect();
		const destroyed = [];
		for (const stream of this.activeStreams.values()) {
			destroyed.push(stream.destroy());
		}
		this.activeStreams.clear();
		if (this.resolveRelease) {
			this.resolveRelease();
			this.resolveRelease = null;
		} else if (!this.pendingRelease) {
			this.pendingRelease = Promise.resolve();
		}
		return Promise.all(destroyed);
	}
} exports.StreamProcessWrapper = StreamProcessWrapper;

/**
 * A ProcessManager wraps a query function: A function that takes a
 * string and returns a string or Promise<string>.
 */
 class ProcessManager {
	
	
	// @ts-ignore
	
	
	
	

	// @ts-ignore
	constructor(module) {
		this.processes = [];
		this.releasingProcesses = [];
		this.module = module;
		this.filename = module.filename;
		this.basename = path.basename(module.filename);
		this.isParentProcess = (process.mainModule !== module || !process.send);

		this.listen();
	}
	acquire() {
		if (!this.processes.length) {
			return null;
		}
		let lowestLoad = this.processes[0];
		for (const process of this.processes) {
			if (process.load < lowestLoad.load) {
				lowestLoad = process;
			}
		}
		return lowestLoad;
	}
	unspawn() {
		const released = [];
		for (const process of this.processes) {
			released.push(process.release().then(() => {
				const index = this.releasingProcesses.indexOf(process);
				if (index >= 0) {
					this.releasingProcesses.splice(index, 1);
				}
			}));
		}
		this.releasingProcesses = this.releasingProcesses.concat(this.processes);
		this.processes = [];
		return Promise.all(released);
	}
	spawn(count = 1) {
		if (!this.isParentProcess) return;
		if (exports.disabled) return;
		while (this.processes.length < count) {
			this.processes.push(this.createProcess());
		}
	}
	respawn(count = null) {
		if (count === null) count = this.processes.length;
		const unspawned = this.unspawn();
		this.spawn(count);
		return unspawned;
	}
	createProcess() {
		throw new Error(`implemented by subclass`);
	}
	listen() {
		throw new Error(`implemented by subclass`);
	}
	destroy() {
		const index = exports.processManagers.indexOf(this);
		if (index >= 0) exports.processManagers.splice(index, 1);
		return this.unspawn();
	}
} exports.ProcessManager = ProcessManager;

 class QueryProcessManager extends ProcessManager {
	// tslint:disable-next-line:variable-name
	

	constructor(module, query) {
		super(module);
		this._query = query;

		exports.processManagers.push(this);
	}
	query(input) {
		const process = this.acquire() ;
		if (!process) return Promise.resolve(this._query(input));
		return process.query(input);
	}
	createProcess() {
		return new QueryProcessWrapper(this.filename);
	}
	listen() {
		if (this.isParentProcess) return;
		// child process
		process.on('message', async (message) => {
			const nlLoc = message.indexOf('\n');
			if (nlLoc <= 0) throw new Error(`Invalid response ${message}`);
			const taskId = message.slice(0, nlLoc);
			message = message.slice(nlLoc + 1);

			if (taskId.startsWith('EVAL')) {
				/* tslint:disable:no-eval */
				// @ts-ignore guaranteed to be defined here
				process.send(`${taskId}\n` + eval(message));
				/* tslint:enable:no-eval */
				return;
			}

			const response = await this._query(JSON.parse(message));
			// @ts-ignore guaranteed to be defined here
			process.send(`${taskId}\n${JSON.stringify(response)}`);
		});
		process.on('disconnect', () => {
			process.exit();
		});
	}
} exports.QueryProcessManager = QueryProcessManager;

 class StreamProcessManager extends ProcessManager {
	/* taskid: stream used only in child process */
	
	// tslint:disable-next-line:variable-name
	

	constructor(module, createStream) {
		super(module);
		this.activeStreams = new Map();
		this._createStream = createStream;

		exports.processManagers.push(this);
	}
	createStream() {
		const process = this.acquire() ;
		if (!process) return this._createStream();
		return process.createStream();
	}
	createProcess() {
		return new StreamProcessWrapper(this.filename);
	}
	async pipeStream(taskId, stream) {
		let done = false;
		while (!done) {
			try {
				let value;
				({value, done} = await stream.next());
				process.send(`${taskId}\nPUSH\n${value}`);
			} catch (err) {
				process.send(`${taskId}\nTHROW\n${err.stack}`);
			}
		}
		process.send(`${taskId}\nEND`);
		this.activeStreams.delete(taskId);
	}
	listen() {
		if (this.isParentProcess) return;
		// child process
		process.on('message', async (message) => {
			let nlLoc = message.indexOf('\n');
			if (nlLoc <= 0) throw new Error(`Invalid request ${message}`);
			const taskId = message.slice(0, nlLoc);
			const stream = this.activeStreams.get(taskId);

			message = message.slice(nlLoc + 1);
			nlLoc = message.indexOf('\n');
			if (nlLoc < 0) nlLoc = message.length;
			const messageType = message.slice(0, nlLoc);
			message = message.slice(nlLoc + 1);

			if (taskId.startsWith('EVAL')) {
				/* tslint:disable:no-eval */
				// @ts-ignore guaranteed to be a child process
				process.send(`${taskId}\n` + eval(message));
				/* tslint:enable:no-eval */
				return;
			}

			if (messageType === 'NEW') {
				if (stream) throw new Error(`NEW: taskId ${taskId} already exists`);
				const newStream = this._createStream();
				this.activeStreams.set(taskId, newStream);
				return this.pipeStream(taskId, newStream);
			} else if (messageType === 'DESTROY') {
				if (!stream) throw new Error(`DESTROY: Invalid taskId ${taskId}`);
				const destroyed = stream.destroy();
				this.activeStreams.delete(taskId);
				return destroyed;
			} else if (messageType === 'WRITE') {
				if (!stream) throw new Error(`WRITE: Invalid taskId ${taskId}`);
				stream.write(message);
			} else {
				throw new Error(`Unrecognized messageType ${messageType}`);
			}
		});
		process.on('disconnect', () => {
			process.exit();
		});
	}
} exports.StreamProcessManager = StreamProcessManager;
