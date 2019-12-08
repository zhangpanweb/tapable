/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/
"use strict";

/**
 * Hook基类，其实例必须实现compile方法，实例方法包括：
 * 1、tap，注册一个type为sync的tap，参数为options和fn，注册时，会在options上跑一遍所以已经注册的interceptor，最终记录在this.taps中
 * 2、tapAsync、tapPromise与tap类似，只是type类型不一样
 * 3、intercept，注册一个拦截器（类似中间件），注册时，会在taps所有tap的基础上执行一次，执行结果按顺序放回taps
 * 4、withOptions，科利化实例，接受options，返回一个新的hook，此hook实例上的tap等方法接受新的opt参数
 * 5、call、promise、callAsync 等，执行实例方法compile，返回一个compiler函数
 * 原型方法：
 * _call、_promise、_callAsync 等，执行实例方法compile，返回一个compiler函数
 */

class Hook {
	constructor(args) {
		if (!Array.isArray(args)) args = [];
		this._args = args; //最终会通过compile方法传递给HookCodeFactory作为其实例的this._args
		this.taps = [];
		this.interceptors = [];
		this.call = this._call; // 将原型方法_call代理到call上
		this.promise = this._promise;
		this.callAsync = this._callAsync;
		this._x = undefined;
	}

	compile(options) {
		throw new Error("Abstract: should be overriden");
	}

	_createCall(type) {
		return this.compile({
			taps: this.taps,
			interceptors: this.interceptors,
			args: this._args,
			type: type
		});
	}

	/**
	 * const Hook = new SyncHook();
	 * hook.tap('logPlugin', () => console.log('checked'));
	 * hook.call();
	 */
	tap(options, fn) {
		//解析 options
		if (typeof options === "string") options = { name: options };
		if (typeof options !== "object" || options === null)
			throw new Error(
				"Invalid arguments to tap(options: Object, fn: function)"
			);
		options = Object.assign({ type: "sync", fn: fn }, options); //type 为 sync
		if (typeof options.name !== "string" || options.name === "")
			throw new Error("Missing name for tap");
		options = this._runRegisterInterceptors(options);
		this._insert(options);
	}

	tapAsync(options, fn) {
		if (typeof options === "string") options = { name: options };
		if (typeof options !== "object" || options === null)
			throw new Error(
				"Invalid arguments to tapAsync(options: Object, fn: function)"
			);
		options = Object.assign({ type: "async", fn: fn }, options); // type 为 async
		if (typeof options.name !== "string" || options.name === "")
			throw new Error("Missing name for tapAsync");
		options = this._runRegisterInterceptors(options);
		this._insert(options);
	}

	tapPromise(options, fn) {
		if (typeof options === "string") options = { name: options };
		if (typeof options !== "object" || options === null)
			throw new Error(
				"Invalid arguments to tapPromise(options: Object, fn: function)"
			);
		options = Object.assign({ type: "promise", fn: fn }, options); // type 为 promise
		if (typeof options.name !== "string" || options.name === "")
			throw new Error("Missing name for tapPromise");
		options = this._runRegisterInterceptors(options);
		this._insert(options);
	}

	// 跑之前被注册过的拦截器，类似于中间件
	_runRegisterInterceptors(options) {
		for (const interceptor of this.interceptors) {
			if (interceptor.register) {
				// 按顺序遍历 interceptors ，如果interceptor有register方法，则对options执行此方法，
				// 然后将此输出作为下一个register的输入，最终返回所有interceptors执行完毕的结果
				const newOptions = interceptor.register(options);
				if (newOptions !== undefined) options = newOptions;
			}
		}
		return options;
	}

	// 产出一个类似函数科里化的实例科里化，接受一个 options，返回一个新的hook，拥有tap等方法，可以接受新的opt方法
	withOptions(options) {
		const mergeOptions = opt =>
			Object.assign({}, options, typeof opt === "string" ? { name: opt } : opt);

		// Prevent creating endless prototype chains
		options = Object.assign({}, options, this._withOptions);
		const base = this._withOptionsBase || this;
		const newHook = Object.create(base);

		(newHook.tapAsync = (opt, fn) => base.tapAsync(mergeOptions(opt), fn)),
			(newHook.tap = (opt, fn) => base.tap(mergeOptions(opt), fn));
		newHook.tapPromise = (opt, fn) => base.tapPromise(mergeOptions(opt), fn);
		newHook._withOptions = options;
		newHook._withOptionsBase = base;
		return newHook;
	}

	isUsed() {
		return this.taps.length > 0 || this.interceptors.length > 0;
	}

	intercept(interceptor) {
		this._resetCompilation();
		this.interceptors.push(Object.assign({}, interceptor)); // 放在 interceptors 末尾
		if (interceptor.register) {
			for (let i = 0; i < this.taps.length; i++)
				this.taps[i] = interceptor.register(this.taps[i]); // 对每个tap执行interceptor.register，并把结果仍然赋给对应tap
		}
	}

	_resetCompilation() {
		this.call = this._call;
		this.callAsync = this._callAsync;
		this.promise = this._promise;
	}

	/**
	 * 将 item 插入 taps 中，放在所有 item.before 以及所有大于 item.stage 的项前面
	 */
	_insert(item) {
		this._resetCompilation();
		let before;
		if (typeof item.before === "string") before = new Set([item.before]);
		else if (Array.isArray(item.before)) {
			before = new Set(item.before);
		}
		let stage = 0;
		if (typeof item.stage === "number") stage = item.stage;
		let i = this.taps.length;
		while (i > 0) {
			i--;
			const x = this.taps[i];
			this.taps[i + 1] = x;
			const xStage = x.stage || 0;
			if (before) {
				if (before.has(x.name)) {
					before.delete(x.name);
					continue;
				}
				if (before.size > 0) {
					continue;
				}
			}
			if (xStage > stage) {
				continue;
			}
			i++;
			break;
		}
		this.taps[i] = item;
	}
}

function createCompileDelegate(name, type) {
	return function lazyCompileHook(...args) {
		this[name] = this._createCall(type); // 执行子类的compile方法，返回一个compiler
		return this[name](...args);
	};
}

Object.defineProperties(Hook.prototype, {
	_call: {
		value: createCompileDelegate("call", "sync"),
		configurable: true,
		writable: true
	},
	_promise: {
		value: createCompileDelegate("promise", "promise"),
		configurable: true,
		writable: true
	},
	_callAsync: {
		value: createCompileDelegate("callAsync", "async"),
		configurable: true,
		writable: true
	}
});

module.exports = Hook;
